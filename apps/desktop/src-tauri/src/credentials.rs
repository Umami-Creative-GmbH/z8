//! Server-scoped secrets in the current Windows user's credential vault.
use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};
use std::path::Path;

pub struct Credentials {
    target: String,
}
impl Credentials {
    pub fn new(directory: &Path, server: &str) -> Self {
        let scope = format!("{}\n{}", directory.display(), server.trim_end_matches('/'));
        Self {
            target: format!("Z8/desktop/{:x}", Sha256::digest(scope.as_bytes())),
        }
    }
    #[cfg(windows)]
    pub fn read(&self) -> Result<Option<String>> {
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_NOT_FOUND},
            Security::Credentials::*,
        };
        let target: Vec<u16> = self.target.encode_utf16().chain(Some(0)).collect();
        let mut credential = std::ptr::null_mut();
        unsafe {
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err(anyhow!("Windows could not read the saved sign-in."))
                };
            }
            let item = &*credential;
            let token = String::from_utf8(
                std::slice::from_raw_parts(item.CredentialBlob, item.CredentialBlobSize as usize)
                    .to_vec(),
            );
            CredFree(credential.cast());
            Ok(Some(token.map_err(|_| {
                anyhow!("The saved sign-in is unreadable. Sign in again.")
            })?))
        }
    }
    #[cfg(not(windows))]
    pub fn read(&self) -> Result<Option<String>> {
        Ok(None)
    }
    #[cfg(windows)]
    pub fn write(&self, token: Option<&str>) -> Result<()> {
        use windows_sys::Win32::{
            Foundation::{GetLastError, ERROR_NOT_FOUND},
            Security::Credentials::*,
        };
        let mut target: Vec<u16> = self.target.encode_utf16().chain(Some(0)).collect();
        unsafe {
            if let Some(token) = token {
                if token.is_empty() || token.len() > 2560 {
                    return Err(anyhow!("Invalid sign-in credential."));
                }
                let mut blob = token.as_bytes().to_vec();
                let mut username: Vec<u16> = "Z8".encode_utf16().chain(Some(0)).collect();
                let credential = CREDENTIALW {
                    Flags: 0,
                    Type: CRED_TYPE_GENERIC,
                    TargetName: target.as_mut_ptr(),
                    Comment: std::ptr::null_mut(),
                    LastWritten: std::mem::zeroed(),
                    CredentialBlobSize: blob.len() as u32,
                    CredentialBlob: blob.as_mut_ptr(),
                    Persist: CRED_PERSIST_LOCAL_MACHINE,
                    AttributeCount: 0,
                    Attributes: std::ptr::null_mut(),
                    TargetAlias: std::ptr::null_mut(),
                    UserName: username.as_mut_ptr(),
                };
                if CredWriteW(&credential, 0) == 0 {
                    return Err(anyhow!(
                        "Windows could not protect the sign-in. Nothing was saved."
                    ));
                }
            } else if CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) == 0
                && GetLastError() != ERROR_NOT_FOUND
            {
                return Err(anyhow!("Windows could not remove the saved sign-in."));
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    pub fn write(&self, _token: Option<&str>) -> Result<()> {
        Err(anyhow!(
            "Protected sign-in is supported on Windows in this release."
        ))
    }
}
