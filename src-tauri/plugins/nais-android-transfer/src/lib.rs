use serde::{de::DeserializeOwned, Serialize};
use tauri::{plugin::TauriPlugin, Manager, Runtime};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

mod commands;
mod error;
pub mod types;

pub use error::{Error, Result};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.sunakgo.nais2.transfer";

/// The handle links Tauri commands to the tracked Kotlin scheduler. On every
/// non-Android target it intentionally returns a stable unsupported result.
pub struct AndroidTransfer<R: Runtime> {
    #[cfg(target_os = "android")]
    mobile_plugin_handle: PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> AndroidTransfer<R> {
    pub(crate) fn call<I: Serialize, O: DeserializeOwned>(
        &self,
        command: &str,
        payload: I,
    ) -> Result<O> {
        #[cfg(target_os = "android")]
        {
            self.mobile_plugin_handle
                .run_mobile_plugin(command, payload)
                .map_err(|_| Error::native())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (command, payload);
            Err(Error::unsupported())
        }
    }
}

pub trait AndroidTransferExt<R: Runtime> {
    fn android_transfer(&self) -> &AndroidTransfer<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidTransferExt<R> for T {
    fn android_transfer(&self) -> &AndroidTransfer<R> {
        self.state::<AndroidTransfer<R>>().inner()
    }
}

/// Registers only scheduling/control commands. A transport executor must be
/// connected separately before the application's capability may report support.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("nais-android-transfer")
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let transfer = AndroidTransfer {
                mobile_plugin_handle: _api
                    .register_android_plugin(PLUGIN_IDENTIFIER, "AndroidTransferPlugin")?,
            };
            #[cfg(not(target_os = "android"))]
            let transfer: AndroidTransfer<R> = AndroidTransfer {
                _marker: std::marker::PhantomData,
            };

            app.manage(transfer);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::schedule,
            commands::pause,
            commands::resume,
            commands::cancel,
            commands::retry,
            commands::checkpoint,
            commands::status,
            commands::recover,
        ])
        .build()
}
