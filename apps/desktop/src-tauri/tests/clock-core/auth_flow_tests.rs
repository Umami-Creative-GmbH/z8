use crate::auth_flow::{Callback, LoginAttempt};
use std::time::{Duration, Instant};
use url::Url;

#[test]
fn browser_sign_in_cannot_return_through_another_callback_origin() {
    let now = Instant::now();
    let (attempt, login) = LoginAttempt::begin("https://time.example", now).unwrap();
    assert!(login.starts_with("https://time.example/api/auth/app-login?"));
    for callback in [
        "z8://other/callback?code=secret",
        "z8://auth/other?code=secret",
        "https://auth/callback?code=secret",
        "z8://user@auth/callback?code=secret",
        "z8://auth:123/callback?code=secret",
        "z8://auth/callback?code=one&code=two",
        "z8://auth/callback?code=one&error=denied",
    ] {
        assert!(
            attempt
                .claim("https://time.example", &Url::parse(callback).unwrap(), now)
                .is_err(),
            "accepted {callback}"
        );
    }
}

#[test]
fn browser_sign_in_is_bound_to_the_original_server_and_expiry() {
    let now = Instant::now();
    let (attempt, _) = LoginAttempt::begin("https://time.example", now).unwrap();
    let callback = Url::parse("z8://auth/callback?code=one-time-code").unwrap();
    assert!(attempt
        .claim("https://other.example", &callback, now)
        .is_err());
    assert!(attempt
        .claim(
            "https://time.example",
            &callback,
            now + Duration::from_secs(301)
        )
        .is_err());
    match attempt
        .claim("https://time.example", &callback, now)
        .unwrap()
    {
        Callback::Code(code) => assert_eq!(code, "one-time-code"),
        Callback::Error(_) => panic!("valid sign-in refused"),
    }
}
