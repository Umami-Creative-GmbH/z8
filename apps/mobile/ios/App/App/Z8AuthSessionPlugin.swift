import AuthenticationServices
import Capacitor
import UIKit

/// Store app sign-in in the system browser (#842).
///
/// Opens the sign-in URL in an `ASWebAuthenticationSession` and resolves with the
/// callback URL once the server redirects to `callbackScheme`. The session itself
/// intercepts that scheme, so the app registers no URL scheme for it.
///
/// The session is ephemeral: the browser keeps no Z8 cookie after sign-in, so the
/// app's session lives only in the web view. Passkeys, SSO and social sign-in
/// work as in Safari; an identity provider's own session is not reused.
///
/// JavaScript: `apps/webapp/src/lib/store-app/native-auth-session.ts`.
@objc(Z8AuthSessionPlugin)
public class Z8AuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "Z8AuthSessionPlugin"
    public let jsName = "Z8AuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard let value = call.getString("url"), let url = URL(string: value), url.scheme == "https" else {
            call.reject("A https sign-in URL is required", "failed")
            return
        }
        guard let callbackScheme = call.getString("callbackScheme"), !callbackScheme.isEmpty else {
            call.reject("A callback scheme is required", "failed")
            return
        }

        DispatchQueue.main.async {
            // Only one sign-in at a time; a new one replaces an abandoned sheet.
            self.session?.cancel()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.reject("Sign-in was cancelled", "cancelled")
                } else {
                    call.reject("Sign-in could not be completed", "failed")
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Sign-in could not start", "failed")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}

/// The shell's bridge view controller: registers the app's own plugins.
class Z8BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(Z8AuthSessionPlugin())
    }
}
