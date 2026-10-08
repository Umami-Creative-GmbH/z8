#[cfg(windows)]
#[test]
#[ignore = "Explicit isolated native QA setup; never part of the regular suite"]
fn prepare_native_qa_session() {
    let directory = std::path::PathBuf::from(
        std::env::var("Z8_NATIVE_QA_DIRECTORY").expect("QA directory required"),
    );
    assert_eq!(directory.file_name().unwrap(), ".native-qa");
    assert!(directory.is_dir());
    let server = "http://127.0.0.1:9231";
    crate::credentials::Credentials::new(&directory, server)
        .write(Some("native-qa-only-token"))
        .unwrap();
    std::fs::write(
        directory.join("settings.json"),
        serde_json::json!({
            "webapp_url": server, "always_on_top":false, "auto_startup":false,
            "idle_enabled":false, "idle_threshold_minutes":10, "language":"en"
        })
        .to_string(),
    )
    .unwrap();
}

#[cfg(windows)]
#[test]
#[ignore = "Explicit cleanup of the isolated native QA credential"]
fn remove_native_qa_session() {
    let directory = std::path::PathBuf::from(
        std::env::var("Z8_NATIVE_QA_DIRECTORY").expect("QA directory required"),
    );
    assert_eq!(directory.file_name().unwrap(), ".native-qa");
    crate::credentials::Credentials::new(&directory, "http://127.0.0.1:9231")
        .write(None)
        .unwrap();
    crate::credentials::Credentials::new(
        &directory.canonicalize().unwrap(),
        "http://127.0.0.1:9231",
    )
    .write(None)
    .unwrap();
}
