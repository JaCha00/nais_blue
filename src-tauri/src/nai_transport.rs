use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{
    ipc::{Channel, Response},
    State,
};
use tokio::sync::oneshot;

const STANDARD_ENDPOINT: &str = "https://image.novelai.net/ai/generate-image";
const STREAM_ENDPOINT: &str = "https://image.novelai.net/ai/generate-image-stream";
const MAX_REQUEST_ID_BYTES: usize = 160;
const MAX_TOKEN_BYTES: usize = 16 * 1024;
const MAX_PAYLOAD_BYTES: usize = 128 * 1024 * 1024;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 300_000;
const CONNECT_TIMEOUT_MS: u64 = 15_000;
const IPC_CHUNK_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NaiGenerationEndpoint {
    Standard,
    Stream,
}

impl NaiGenerationEndpoint {
    fn url(&self) -> &'static str {
        match self {
            Self::Standard => STANDARD_ENDPOINT,
            Self::Stream => STREAM_ENDPOINT,
        }
    }

    fn accepts_msgpack(&self) -> bool {
        matches!(self, Self::Stream)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum NaiTransportEvent {
    DnsConnect,
    RequestSent,
    ResponseHeaders {
        status: u16,
        #[serde(rename = "contentType")]
        content_type: Option<String>,
    },
    End,
    Cancelled,
    Timeout,
    Error {
        kind: &'static str,
    },
}

#[derive(Default)]
pub struct NaiTransportState {
    active: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl NaiTransportState {
    fn register(&self, request_id: &str) -> Result<oneshot::Receiver<()>, String> {
        let (sender, receiver) = oneshot::channel();
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Native transport state is unavailable".to_string())?;
        if active.contains_key(request_id) {
            return Err("Native transport request identifier is already active".to_string());
        }
        active.insert(request_id.to_string(), sender);
        Ok(receiver)
    }

    fn cancel(&self, request_id: &str) -> bool {
        let sender = self
            .active
            .lock()
            .ok()
            .and_then(|mut active| active.remove(request_id));
        sender.is_some_and(|sender| sender.send(()).is_ok())
    }

    fn release(&self, request_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(request_id);
        }
    }
}

fn validate_request(
    request_id: &str,
    token: &str,
    payload: &str,
    timeout_ms: u64,
) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > MAX_REQUEST_ID_BYTES
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err("Native transport request identifier is invalid".to_string());
    }
    if token.trim().is_empty() || token.len() > MAX_TOKEN_BYTES {
        return Err("Native transport credential is invalid".to_string());
    }
    if payload.is_empty() || payload.len() > MAX_PAYLOAD_BYTES {
        return Err("Native transport payload size is invalid".to_string());
    }
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err("Native transport timeout is outside the supported range".to_string());
    }
    Ok(())
}

fn send_event(
    channel: &Channel<NaiTransportEvent>,
    event: NaiTransportEvent,
) -> Result<(), String> {
    channel
        .send(event)
        .map_err(|_| "Native transport event channel is unavailable".to_string())
}

fn send_reqwest_failure(
    channel: &Channel<NaiTransportEvent>,
    error: &reqwest::Error,
) -> Result<(), String> {
    if error.is_timeout() {
        send_event(channel, NaiTransportEvent::Timeout)
    } else {
        send_event(
            channel,
            NaiTransportEvent::Error {
                kind: if error.is_connect() {
                    "network"
                } else {
                    "transport"
                },
            },
        )
    }
}

async fn run_request(
    endpoint_url: String,
    accepts_msgpack: bool,
    token: String,
    payload: String,
    timeout_ms: u64,
    mut cancelled: oneshot::Receiver<()>,
    on_event: Channel<NaiTransportEvent>,
    on_body: Channel<Response>,
) -> Result<(), String> {
    let total_timeout = Duration::from_millis(timeout_ms);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(CONNECT_TIMEOUT_MS.min(timeout_ms)))
        .timeout(total_timeout)
        .build()
        .map_err(|_| "Native transport client initialization failed".to_string())?;

    send_event(&on_event, NaiTransportEvent::DnsConnect)?;
    let mut builder = client
        .post(endpoint_url)
        .header("Authorization", format!("Bearer {}", token.trim()))
        .header("Content-Type", "application/json")
        .header("User-Agent", "NAIS2_Client/1.0")
        .body(payload);
    if accepts_msgpack {
        builder = builder.header("Accept", "application/x-msgpack");
    }
    send_event(&on_event, NaiTransportEvent::RequestSent)?;

    let response = tokio::select! {
        _ = &mut cancelled => {
            send_event(&on_event, NaiTransportEvent::Cancelled)?;
            return Ok(());
        }
        result = builder.send() => match result {
            Ok(response) => response,
            Err(error) => {
                send_reqwest_failure(&on_event, &error)?;
                return Ok(());
            }
        }
    };

    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    send_event(
        &on_event,
        NaiTransportEvent::ResponseHeaders {
            status,
            content_type,
        },
    )?;

    let mut response = response;
    loop {
        let next = tokio::select! {
            _ = &mut cancelled => {
                send_event(&on_event, NaiTransportEvent::Cancelled)?;
                return Ok(());
            }
            result = response.chunk() => result
        };

        match next {
            Ok(Some(chunk)) => {
                for part in chunk.chunks(IPC_CHUNK_BYTES) {
                    on_body
                        .send(Response::new(part.to_vec()))
                        .map_err(|_| "Native transport body channel is unavailable".to_string())?;
                }
            }
            Ok(None) => {
                send_event(&on_event, NaiTransportEvent::End)?;
                return Ok(());
            }
            Err(error) => {
                send_reqwest_failure(&on_event, &error)?;
                return Ok(());
            }
        }
    }
}

#[tauri::command]
pub async fn nai_generate_request(
    request_id: String,
    endpoint: NaiGenerationEndpoint,
    token: String,
    payload: String,
    timeout_ms: u64,
    on_event: Channel<NaiTransportEvent>,
    on_body: Channel<Response>,
    state: State<'_, NaiTransportState>,
) -> Result<(), String> {
    validate_request(&request_id, &token, &payload, timeout_ms)?;
    let cancelled = state.register(&request_id)?;
    let endpoint_url = endpoint.url().to_string();
    let accepts_msgpack = endpoint.accepts_msgpack();
    let result = run_request(
        endpoint_url,
        accepts_msgpack,
        token,
        payload,
        timeout_ms,
        cancelled,
        on_event,
        on_body,
    )
    .await;
    state.release(&request_id);
    result
}

#[tauri::command]
pub fn cancel_nai_request(request_id: String, state: State<'_, NaiTransportState>) -> bool {
    state.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tauri::ipc::InvokeResponseBody;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        time::{sleep, timeout},
    };

    fn capture_channels() -> (
        Channel<NaiTransportEvent>,
        Channel<Response>,
        Arc<Mutex<Vec<String>>>,
        Arc<Mutex<Vec<u8>>>,
    ) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let event_capture = Arc::clone(&events);
        let event_channel = Channel::new(move |message| {
            if let InvokeResponseBody::Json(json) = message {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
                    if let Some(event_type) = value.get("type").and_then(|value| value.as_str()) {
                        if let Ok(mut captured) = event_capture.lock() {
                            captured.push(event_type.to_string());
                        }
                    }
                }
            }
            Ok(())
        });

        let body = Arc::new(Mutex::new(Vec::new()));
        let body_capture = Arc::clone(&body);
        let body_channel = Channel::new(move |message| {
            if let InvokeResponseBody::Raw(bytes) = message {
                if let Ok(mut captured) = body_capture.lock() {
                    captured.extend(bytes);
                }
            }
            Ok(())
        });

        (event_channel, body_channel, events, body)
    }

    async fn wait_for_event(events: &Arc<Mutex<Vec<String>>>, expected: &str) {
        timeout(Duration::from_secs(2), async {
            loop {
                if events
                    .lock()
                    .is_ok_and(|captured| captured.iter().any(|event| event == expected))
                {
                    return;
                }
                sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("native transport event should arrive within the test deadline");
    }

    #[test]
    fn generation_endpoints_are_fixed_and_not_caller_supplied() {
        assert_eq!(NaiGenerationEndpoint::Standard.url(), STANDARD_ENDPOINT);
        assert_eq!(NaiGenerationEndpoint::Stream.url(), STREAM_ENDPOINT);
    }

    #[test]
    fn cancellation_is_scoped_to_the_registered_request() {
        let state = NaiTransportState::default();
        let first = state
            .register("request-1")
            .expect("first request should register");
        let mut second = state
            .register("request-2")
            .expect("second request should register");

        assert!(state.cancel("request-1"));
        assert!(first.blocking_recv().is_ok());
        assert!(second.try_recv().is_err());
        state.release("request-2");
    }

    #[tokio::test]
    async fn reqwest_path_forwards_headers_and_body_chunks_from_a_mock_server() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock listener should bind");
        let address = listener
            .local_addr()
            .expect("mock listener should have an address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener
                .accept()
                .await
                .expect("mock request should connect");
            let mut request = vec![0_u8; 8 * 1024];
            let read = socket
                .read(&mut request)
                .await
                .expect("mock request should be readable");
            let request = String::from_utf8_lossy(&request[..read]);
            let accepts_msgpack = request
                .to_ascii_lowercase()
                .contains("accept: application/x-msgpack");
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nContent-Type: application/x-msgpack\r\n\r\n")
                .await
                .expect("mock headers should write");
            socket
                .write_all(&[1, 2])
                .await
                .expect("first body chunk should write");
            sleep(Duration::from_millis(10)).await;
            socket
                .write_all(&[3])
                .await
                .expect("second body chunk should write");
            accepts_msgpack
        });
        let (_cancel_sender, cancel_receiver) = oneshot::channel();
        let (events_channel, body_channel, events, body) = capture_channels();

        run_request(
            format!("http://{address}"),
            true,
            "synthetic-token".to_string(),
            "{}".to_string(),
            1_000,
            cancel_receiver,
            events_channel,
            body_channel,
        )
        .await
        .expect("native mock request should complete");

        assert!(server.await.expect("mock server should finish"));
        assert_eq!(
            *body.lock().expect("body capture should lock"),
            vec![1, 2, 3]
        );
        let events = events.lock().expect("event capture should lock");
        assert!(events.iter().any(|event| event == "dns-connect"));
        assert!(events.iter().any(|event| event == "request-sent"));
        assert!(events.iter().any(|event| event == "response-headers"));
        assert!(events.iter().any(|event| event == "end"));
    }

    #[tokio::test]
    async fn cancellation_drops_the_active_mock_server_response() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock listener should bind");
        let address = listener
            .local_addr()
            .expect("mock listener should have an address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener
                .accept()
                .await
                .expect("mock request should connect");
            let mut request = vec![0_u8; 8 * 1024];
            socket
                .read(&mut request)
                .await
                .expect("mock request should be readable");
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1048576\r\nContent-Type: application/x-msgpack\r\n\r\npartial")
                .await
                .expect("mock partial response should write");
            let mut probe = [0_u8; 1];
            matches!(
                timeout(Duration::from_secs(2), socket.read(&mut probe)).await,
                Ok(Ok(0)),
            )
        });
        let (cancel_sender, cancel_receiver) = oneshot::channel();
        let (events_channel, body_channel, events, _body) = capture_channels();
        let request = tokio::spawn(run_request(
            format!("http://{address}"),
            true,
            "synthetic-token".to_string(),
            "{}".to_string(),
            1_000,
            cancel_receiver,
            events_channel,
            body_channel,
        ));

        wait_for_event(&events, "response-headers").await;
        cancel_sender
            .send(())
            .expect("mock cancellation should send");
        request
            .await
            .expect("native request task should join")
            .expect("native cancellation should complete cleanly");

        wait_for_event(&events, "cancelled").await;
        assert!(server
            .await
            .expect("mock server should observe the closed response"));
    }

    #[tokio::test]
    async fn reqwest_total_timeout_terminates_a_hung_mock_server() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("mock listener should bind");
        let address = listener
            .local_addr()
            .expect("mock listener should have an address");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener
                .accept()
                .await
                .expect("mock request should connect");
            let mut request = vec![0_u8; 8 * 1024];
            socket
                .read(&mut request)
                .await
                .expect("mock request should be readable");
            sleep(Duration::from_millis(250)).await;
        });
        let (_cancel_sender, cancel_receiver) = oneshot::channel();
        let (events_channel, body_channel, events, _body) = capture_channels();

        run_request(
            format!("http://{address}"),
            false,
            "synthetic-token".to_string(),
            "{}".to_string(),
            30,
            cancel_receiver,
            events_channel,
            body_channel,
        )
        .await
        .expect("native timeout should use a typed event");

        wait_for_event(&events, "timeout").await;
        server.await.expect("mock server should finish");
    }
}
