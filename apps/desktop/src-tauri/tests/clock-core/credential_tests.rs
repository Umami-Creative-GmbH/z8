#[cfg(windows)]
#[test]
fn persisted_sign_in_is_private_to_its_server_and_can_be_removed() {
    let directory = tempfile::tempdir().unwrap();
    let first = crate::credentials::Credentials::new(directory.path(), "https://first.example");
    let other = crate::credentials::Credentials::new(directory.path(), "https://other.example");
    first.write(Some("test-only-token")).unwrap();
    assert_eq!(first.read().unwrap().as_deref(), Some("test-only-token"));
    assert_eq!(other.read().unwrap(), None);
    first.write(None).unwrap();
    assert_eq!(first.read().unwrap(), None);
}
