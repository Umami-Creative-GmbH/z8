import { Redirect } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import {
  useMobileSession,
  useMobileSessionController,
} from "@/src/features/session/use-mobile-session";
import { buildAppLoginUrl } from "@/src/lib/auth/app-auth";
import { getWebappUrl } from "@/src/lib/config";

export default function SignInScreen() {
  const { data: session, isError, isLoading, refetch } = useMobileSession();
  const controller = useMobileSessionController();
  const [isStartingSignIn, setIsStartingSignIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const routeState = getMobileSessionRouteState({ session, isError, isLoading });

  if (routeState === "error") {
    return <MobileSessionErrorState onRetry={() => void refetch()} />;
  }

  if (routeState === "signed-in") {
    return <Redirect href="/" />;
  }

  async function handleSignIn() {
    const redirectUri = Linking.createURL("auth/callback");

    setSignInError(null);
    setIsStartingSignIn(true);

    try {
      const result = await WebBrowser.openAuthSessionAsync(
        buildAppLoginUrl(getWebappUrl(), redirectUri),
        redirectUri,
      );

      if (result.type === "success" && result.url) {
        const callbackState = await controller.handleCallbackUrl(result.url);

        if (callbackState.status === "error") {
          setSignInError(
            callbackState.error === "access_denied"
              ? "Your account does not have mobile app access. Contact your administrator."
              : "Sign-in could not be completed. Please try again.",
          );
        }
      }
    } finally {
      setIsStartingSignIn(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign In</Text>
      <Text style={styles.subtitle}>Continue in the browser to connect your Z8 account.</Text>
      {signInError ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorText}>
          {signInError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={isStartingSignIn || routeState === "loading"}
        onPress={handleSignIn}
        style={[styles.button, isStartingSignIn && styles.buttonDisabled]}
      >
        <Text style={styles.buttonLabel}>
          {isStartingSignIn ? "Opening Browser…" : "Continue in Browser"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#f8fafc",
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0f172a",
  },
  subtitle: {
    marginTop: 8,
    color: "#475569",
    textAlign: "center",
  },
  errorText: {
    marginTop: 12,
    color: "#b91c1c",
    textAlign: "center",
  },
  button: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563eb",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
