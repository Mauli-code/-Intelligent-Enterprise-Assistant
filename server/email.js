import nodemailer from "nodemailer";

const defaultTimeoutMs = 10000;
let testTransport;

export class EmailConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

export class EmailDeliveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new EmailConfigurationError(`Missing ${name}.`);
  }
  return value;
}

function smtpConfiguration() {
  const port = Number(requiredEnvironment("SMTP_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EmailConfigurationError("SMTP_PORT must be a valid port.");
  }

  return {
    host: requiredEnvironment("SMTP_HOST"),
    port,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: requiredEnvironment("SMTP_USER"),
      pass: requiredEnvironment("SMTP_PASSWORD"),
    },
    connectionTimeout: defaultTimeoutMs,
    greetingTimeout: defaultTimeoutMs,
    socketTimeout: defaultTimeoutMs,
  };
}

function smtpTransport(configuration) {
  if (testTransport) return testTransport;
  return nodemailer.createTransport(configuration);
}

export function setEmailTransportForTests(transport) {
  testTransport = transport;
}

export function resetEmailTransportForTests() {
  testTransport = undefined;
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

/**
 * Development delivery mode. It exists so a reviewer can complete the email
 * second factor without an SMTP account. It is impossible to enable in
 * production and it never sends mail.
 */
export function devOtpEnabled() {
  if (isProduction()) return false;
  if (String(process.env.IEA_DEV_OTP || "").toLowerCase() === "false") return false;
  return (process.env.AUTH_EMAIL_MODE || "console") === "console";
}

/** Safe, non-secret description of the current email configuration. */
export function emailDeliveryStatus() {
  const mode = process.env.AUTH_EMAIL_MODE || "console";
  return {
    mode,
    devOtp: devOtpEnabled(),
    smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
  };
}

export async function sendOtpEmail(email, code) {
  const mode = process.env.AUTH_EMAIL_MODE || "console";

  if (mode === "console") {
    // Refuse to fall back to a developer shortcut in production.
    if (isProduction() || !devOtpEnabled()) {
      throw new EmailConfigurationError(
        "Email delivery is not configured. Set AUTH_EMAIL_MODE=smtp.",
      );
    }

    console.info(
      `[dev-otp] Verification code for ${email}: ${code} (development mode, no email sent)`,
    );
    return { mode, accepted: true, devCode: code };
  }

  if (mode !== "smtp") {
    throw new EmailConfigurationError("AUTH_EMAIL_MODE must be console or smtp.");
  }

  const from = requiredEnvironment("SMTP_FROM");
  const configuration = smtpConfiguration();

  try {
    let timer;
    const sendPromise = smtpTransport(configuration).sendMail({
      from,
      to: email,
      subject: "Your Intelligent Enterprise Assistant verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
    });
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new EmailDeliveryError("SMTP delivery timed out.")),
        defaultTimeoutMs,
      );
    });
    const result = await Promise.race([sendPromise, timeoutPromise]).finally(() =>
      clearTimeout(timer),
    );

    if (!result?.accepted?.includes(email)) {
      throw new EmailDeliveryError("The SMTP server did not accept the message.");
    }

    return { mode, accepted: true };
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;
    throw new EmailDeliveryError("The SMTP server rejected or did not accept the message.");
  }
}
