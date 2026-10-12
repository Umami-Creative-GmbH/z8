package com.z8.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Plugins that are not npm packages are registered here, before super.onCreate().
        super.onCreate(savedInstanceState);
        // The first page load has only been queued, so its callbacks reach this client.
        if (bridge != null) {
            bridge.setWebViewClient(new ShellWebViewClient(bridge));
        }
    }
}
