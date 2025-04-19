import React from "react";
import "./globals.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <html lang="de">
        <head>
          <meta charSet="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>z8 - by Umami Creative GmbH</title>
        </head>
        <body>{children}</body>
      </html>
    </>
  );
}
