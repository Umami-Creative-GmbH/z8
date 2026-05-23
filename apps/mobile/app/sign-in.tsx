import { Redirect } from "expo-router";
import * as Linking from "expo-linking";
import { Button, Column, Host, Text } from "@expo/ui";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { StyleSheet } from "react-native";

import { MobileSessionErrorState } from "@/src/features/session/mobile-session-error-state";
import { getMobileSessionRouteState } from "@/src/features/session/mobile-session-route-state";
import {
  useMobileSession,
  useMobileSessionController,
} from "@/src/features/session/use-mobile-session";
import { buildAppLoginUrl } from "@/src/lib/auth/app-auth";
import { createAppAuthPkcePair } from "@/src/lib/auth/pkce";
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
      const pkce = await createAppAuthPkcePair();
      const result = await WebBrowser.openAuthSessionAsync(
        buildAppLoginUrl(getWebappUrl(), redirectUri, pkce.challenge),
        redirectUri,
      );

      if (result.type === "success" && result.url) {
        const callbackState = await controller.handleCallbackUrl(result.url, pkce.verifier);

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
    <Host style={styles.container}>
      <Column spacing={12} alignment="center">
        <Text textStyle={styles.titleText}>Sign In</Text>
        <Text textStyle={styles.subtitleText}>Continue in the browser to connect your Z8 account.</Text>
        {signInError ? <Text textStyle={styles.errorText}>{signInError}</Text> : null}
        <Button
          label={isStartingSignIn ? "Opening Browser…" : "Continue in Browser"}
          disabled={isStartingSignIn || routeState === "loading"}
          onPress={handleSignIn}
        />
      </Column>
    </Host>
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
  titleText: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0f172a",
  },
  subtitleText: {
    color: "#475569",
    textAlign: "center",
  },
  errorText: {
    color: "#b91c1c",
    textAlign: "center",
  },
});
