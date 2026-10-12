package com.z8.app;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Shows the offline screen (server.errorPath) only when the web app cannot be
 * reached. Capacitor also shows it for any HTTP error status of a page, which
 * would replace the web app's own 404 and error pages with "Z8 can't be reached".
 *
 * WebViewListener#onReceivedHttpError is not forwarded (Bridge keeps its listener
 * list package-private). No Capacitor plugin in this app listens to it; check
 * again when adding a plugin that registers a WebViewListener.
 */
public class ShellWebViewClient extends BridgeWebViewClient {

    public ShellWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        // Let the web view render the server's error page.
    }
}
