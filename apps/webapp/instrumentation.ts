import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const isDev = process.env.NODE_ENV === "development";

    const resource = new Resource({
      [ATTR_SERVICE_NAME]: "z8-webapp",
      environment: process.env.NODE_ENV || "development",
    });

    const sdk = new NodeSDK({
      resource,
      spanProcessors: isDev
        ? [new SimpleSpanProcessor(new ConsoleSpanExporter())]
        : [
            new BatchSpanProcessor(
              new OTLPTraceExporter({
                url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces",
              })
            ),
          ],
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
        }),
      ],
    });

    sdk.start();

    process.on("SIGTERM", () => {
      sdk.shutdown().finally(() => process.exit(0));
    });
  }
}
