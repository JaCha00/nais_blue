use serde::Serialize;

const NOVELAI_CREDENTIAL_SERVICE: &str = "blue.bluehair.naiblue.novelai";
const MAX_TOKEN_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNovelAiCredentialStatus {
    pub credential_ref: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNovelAiCredentialError {
    pub code: String,
    pub message: String,
}

impl NativeNovelAiCredentialError {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    fn unsupported() -> Self {
        Self::new(
            "E_NOVELAI_VAULT_UNSUPPORTED",
            "The operating-system credential vault is unavailable on this platform build.",
        )
    }
}

fn validate_credential_ref(credential_ref: &str) -> Result<(), NativeNovelAiCredentialError> {
    if matches!(credential_ref, "novelai-slot-1" | "novelai-slot-2") {
        return Ok(());
    }
    Err(NativeNovelAiCredentialError::new(
        "E_NOVELAI_VAULT_REF",
        "The NovelAI credential reference is invalid.",
    ))
}

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
mod desktop {
    use super::*;

    fn entry(credential_ref: &str) -> Result<keyring::Entry, NativeNovelAiCredentialError> {
        validate_credential_ref(credential_ref)?;
        keyring::Entry::new(NOVELAI_CREDENTIAL_SERVICE, credential_ref).map_err(|_| {
            NativeNovelAiCredentialError::new(
                "E_NOVELAI_VAULT_UNAVAILABLE",
                "The operating-system credential vault is unavailable.",
            )
        })
    }

    pub fn store(
        credential_ref: String,
        token: String,
    ) -> Result<NativeNovelAiCredentialStatus, NativeNovelAiCredentialError> {
        validate_credential_ref(&credential_ref)?;
        let token = token.trim();
        if token.len() < 4 || token.len() > MAX_TOKEN_BYTES {
            return Err(NativeNovelAiCredentialError::new(
                "E_NOVELAI_VAULT_SECRET",
                "The NovelAI credential is invalid.",
            ));
        }
        entry(&credential_ref)?
            .set_secret(token.as_bytes())
            .map_err(|_| {
                NativeNovelAiCredentialError::new(
                    "E_NOVELAI_VAULT_WRITE",
                    "The NovelAI credential could not be saved to the operating-system vault.",
                )
            })?;
        Ok(NativeNovelAiCredentialStatus {
            credential_ref,
            available: true,
        })
    }

    pub fn load(credential_ref: String) -> Result<Option<String>, NativeNovelAiCredentialError> {
        match entry(&credential_ref)?.get_secret() {
            Ok(secret) => {
                if secret.len() < 4 || secret.len() > MAX_TOKEN_BYTES {
                    return Err(NativeNovelAiCredentialError::new(
                        "E_NOVELAI_VAULT_INVALID",
                        "The stored NovelAI credential is invalid.",
                    ));
                }
                String::from_utf8(secret).map(Some).map_err(|_| {
                    NativeNovelAiCredentialError::new(
                        "E_NOVELAI_VAULT_INVALID",
                        "The stored NovelAI credential is invalid.",
                    )
                })
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(NativeNovelAiCredentialError::new(
                "E_NOVELAI_VAULT_READ",
                "The NovelAI credential could not be read from the operating-system vault.",
            )),
        }
    }

    pub fn status(
        credential_ref: String,
    ) -> Result<NativeNovelAiCredentialStatus, NativeNovelAiCredentialError> {
        let available = match entry(&credential_ref)?.get_secret() {
            Ok(_) => true,
            Err(keyring::Error::NoEntry) => false,
            Err(_) => {
                return Err(NativeNovelAiCredentialError::new(
                    "E_NOVELAI_VAULT_READ",
                    "The NovelAI credential status is unavailable.",
                ));
            }
        };
        Ok(NativeNovelAiCredentialStatus {
            credential_ref,
            available,
        })
    }

    pub fn delete(credential_ref: String) -> Result<(), NativeNovelAiCredentialError> {
        match entry(&credential_ref)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(NativeNovelAiCredentialError::new(
                "E_NOVELAI_VAULT_DELETE",
                "The NovelAI credential could not be removed from the operating-system vault.",
            )),
        }
    }
}

#[tauri::command]
pub async fn novelai_store_credential(
    credential_ref: String,
    token: String,
) -> Result<NativeNovelAiCredentialStatus, NativeNovelAiCredentialError> {
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        return desktop::store(credential_ref, token);
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = (credential_ref, token);
        Err(NativeNovelAiCredentialError::unsupported())
    }
}

#[tauri::command]
pub async fn novelai_load_credential(
    credential_ref: String,
) -> Result<Option<String>, NativeNovelAiCredentialError> {
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        return desktop::load(credential_ref);
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = credential_ref;
        Err(NativeNovelAiCredentialError::unsupported())
    }
}

#[tauri::command]
pub async fn novelai_credential_status(
    credential_ref: String,
) -> Result<NativeNovelAiCredentialStatus, NativeNovelAiCredentialError> {
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        return desktop::status(credential_ref);
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = credential_ref;
        Err(NativeNovelAiCredentialError::unsupported())
    }
}

#[tauri::command]
pub async fn novelai_delete_credential(
    credential_ref: String,
) -> Result<(), NativeNovelAiCredentialError> {
    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        return desktop::delete(credential_ref);
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = credential_ref;
        Err(NativeNovelAiCredentialError::unsupported())
    }
}
