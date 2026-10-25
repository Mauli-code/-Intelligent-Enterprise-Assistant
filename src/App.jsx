import React, { useEffect, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/chat$/, "")
  : "http://localhost:3001/api";

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      credentials: "include",
    });
  } catch {
    throw new Error(
      "Unable to connect to the backend. Check that the server is running and try again.",
    );
  }
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "The server rejected the request.");
  }

  return data;
}

function providerLabel(provider) {
  if (!provider) return "";
  return provider === "gemini" ? "Gemini" : "Offline NLP";
}

function App() {
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [failedMessage, setFailedMessage] = useState("");
  const [documentFile, setDocumentFile] = useState(null);
  const [documentResult, setDocumentResult] = useState(null);
  const [isDocumentLoading, setIsDocumentLoading] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    request("/config")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  async function refreshConversations(selectedId = conversationId) {
    const data = await request("/conversations");
    setConversations(data.conversations);

    const nextId = selectedId || data.conversations[0]?.id;
    if (nextId) {
      await openConversation(nextId);
    }
  }

  async function openConversation(id) {
    const data = await request(`/conversations/${id}`);
    setConversationId(data.conversation.id);
    setMessages(
      data.conversation.messages.map((savedMessage) => ({
        role: savedMessage.role,
        text: savedMessage.content,
      })),
    );
    setDocumentResult(null);
    setError("");
    setFailedMessage("");
  }

  async function createNewChat() {
    setError("");
    const data = await request("/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setConversationId(data.conversation.id);
    setMessages([]);
    setMessage("");
    setDocumentResult(null);
    await refreshConversations(data.conversation.id);
  }

  async function deleteCurrentConversation(id) {
    if (!window.confirm("Delete this conversation?")) {
      return;
    }

    try {
      await request(`/conversations/${id}`, { method: "DELETE" });
      const remaining = conversations.filter((conversation) => conversation.id !== id);
      setConversations(remaining);

      if (id === conversationId) {
        if (remaining[0]) {
          await openConversation(remaining[0].id);
        } else {
          await createNewChat();
        }
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    request("/auth/me")
      .then((data) => setUserEmail(data.user.email))
      .catch(() => setUserEmail(""));
  }, []);

  useEffect(() => {
    if (!userEmail) return undefined;
    async function loadHistory() {
      try {
        const data = await request("/conversations");
        setConversations(data.conversations);
        if (data.conversations[0]) {
          await openConversation(data.conversations[0].id);
        } else {
          await createNewChat();
        }
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setIsHistoryLoading(false);
      }
    }

    loadHistory();
  }, [userEmail]);

  async function requestCode(event) {
    event.preventDefault();
    setIsAuthLoading(true);
    setError("");
    try {
      const data = await request("/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail }),
      });
      setIsCodeSent(true);
      setAuthMessage(data.message);
      // Development mode returns the code so the flow can be demonstrated
      // without an SMTP account. Production never returns this field.
      if (data.devCode) setAuthCode(data.devCode);
    } catch (requestError) {
      setAuthMessage("");
      setError(requestError.message);
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    setIsAuthLoading(true);
    setError("");
    try {
      const data = await request("/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, code: authCode }),
      });
      setUserEmail(data.user.email);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function logout() {
    try {
      await request("/auth/logout", { method: "POST" });
      setUserEmail("");
      setConversations([]);
      setConversationId("");
      setMessages([]);
      setAuthCode("");
      setIsCodeSent(false);
      setAuthMessage("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function sendMessage(event, messageToSend = message, isRetry = false) {
    event?.preventDefault();
    const trimmedMessage = messageToSend.trim();

    if (!trimmedMessage || isLoading || !conversationId) {
      setError("Please enter a message before sending.");
      return;
    }

    setError("");
    setFailedMessage("");
    setIsLoading(true);
    if (!isRetry) {
      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "user", text: trimmedMessage },
      ]);
      setMessage("");
    }

    try {
      const data = await request("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: trimmedMessage,
        }),
      });

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          role: "assistant",
          text: data.reply,
          sources: data.sources || [],
          provider: data.provider,
          latencyMs: data.latencyMs,
          intent: data.intent?.label,
        },
      ]);
      await refreshConversations(conversationId);
    } catch (requestError) {
      setFailedMessage(trimmedMessage);
      setError(
        requestError.message ||
          "Unable to reach the assistant. Please check that the backend is running.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function clearChat() {
    setMessages([]);
    setMessage("");
    setError("");
    setFailedMessage("");
  }

  async function uploadDocument(event) {
    event.preventDefault();

    if (!documentFile) {
      setError("Please choose a document first.");
      return;
    }

    setError("");
    setDocumentResult(null);
    setIsDocumentLoading(true);
    const formData = new FormData();
    formData.append("document", documentFile);
    formData.append("conversationId", conversationId);

    try {
      const data = await request("/documents", {
        method: "POST",
        body: formData,
      });
      setDocumentResult(data);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsDocumentLoading(false);
    }
  }

  if (!userEmail) {
    return (
      <main className="app-shell auth-shell">
        <section className="chat-card auth-card">
          <h1>Verify your email</h1>
          <p>
            Sign-in uses a six-digit code sent to your email address as the
            second authentication factor.
          </p>
          {config?.email?.devOtp && (
            <p className="dev-note" role="note">
              Development mode is active: no email will be sent and the code is
              shown here. Configure <code>AUTH_EMAIL_MODE=smtp</code> for real
              email delivery.
            </p>
          )}
          <form
            aria-busy={isAuthLoading}
            onSubmit={isCodeSent ? verifyCode : requestCode}
          >
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              disabled={isAuthLoading}
              required
            />
            {isCodeSent && (
              <>
                <label htmlFor="auth-code">Verification code</label>
                <input
                  id="auth-code"
                  inputMode="numeric"
                  maxLength="6"
                  pattern="[0-9]{6}"
                  value={authCode}
                  onChange={(event) =>
                    setAuthCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={isAuthLoading}
                  required
                />
              </>
            )}
            <button className="send-button" disabled={isAuthLoading} type="submit">
              {isAuthLoading
                ? "Please wait..."
                : isCodeSent
                  ? "Verify code"
                  : "Send code"}
            </button>
          </form>
          {authMessage && (
            <p className="auth-message" role="status">
              {authMessage}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  if (isHistoryLoading) {
    return (
      <main className="app-shell">
        <p>Loading conversations...</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="history-panel" aria-label="Conversation history">
        <div className="history-header">
          <h2>History</h2>
          <button className="new-chat-button" type="button" onClick={createNewChat}>
            New chat
          </button>
        </div>
        {conversations.length === 0 ? (
          <p className="history-empty">No conversations yet.</p>
        ) : (
          <ul className="conversation-list">
            {conversations.map((conversation) => (
              <li
                className={conversation.id === conversationId ? "selected" : ""}
                key={conversation.id}
              >
                <button
                  type="button"
                  onClick={() => openConversation(conversation.id)}
                >
                  {conversation.title}
                </button>
                <button
                  aria-label={`Delete ${conversation.title}`}
                  className="delete-button"
                  type="button"
                  onClick={() => deleteCurrentConversation(conversation.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="chat-card" aria-label="Intelligent Enterprise Assistant">
        <header className="chat-header">
          <div>
            <h1>Intelligent Enterprise Assistant</h1>
            <p className="subtitle">
              Ask about HR policy, IT support, company events, or upload a
              document.
            </p>
            <p className="account-status">
              Signed in as {userEmail}
              {config?.provider && (
                <span className="provider-badge">
                  {providerLabel(config.provider)} mode
                </span>
              )}
            </p>
          </div>
          <div className="header-actions">
            <button className="secondary-button" type="button" onClick={clearChat}>
              Clear chat
            </button>
            <button className="secondary-button" type="button" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <p className="empty-state">
              Try: “How do I apply for leave?” or “My laptop will not connect to
              wifi”.
            </p>
          ) : (
            messages.map((chatMessage, index) => (
              <div
                className={`message ${chatMessage.role}`}
                key={`${chatMessage.role}-${index}`}
              >
                <span>{chatMessage.role === "user" ? "You" : "Assistant"}</span>
                <p>{chatMessage.text}</p>
                {chatMessage.role === "assistant" &&
                  (chatMessage.sources?.length > 0 ||
                    chatMessage.provider ||
                    chatMessage.latencyMs) && (
                    <small className="message-meta">
                      {chatMessage.provider && (
                        <span className="meta-chip">
                          {providerLabel(chatMessage.provider)}
                        </span>
                      )}
                      {chatMessage.intent && (
                        <span className="meta-chip">{chatMessage.intent}</span>
                      )}
                      {typeof chatMessage.latencyMs === "number" && (
                        <span className="meta-chip">
                          {Math.round(chatMessage.latencyMs)} ms
                        </span>
                      )}
                      {chatMessage.sources?.length > 0 && (
                        <span>Sources: {chatMessage.sources.join(", ")}</span>
                      )}
                    </small>
                  )}
              </div>
            ))
          )}
          {isLoading && <p className="loading">Assistant is thinking...</p>}
          {failedMessage && !isLoading && (
            <button
              className="retry-button"
              onClick={() => sendMessage(null, failedMessage, true)}
              type="button"
            >
              Retry sending
            </button>
          )}
        </div>

        <form className="message-form" onSubmit={sendMessage}>
          <label htmlFor="message">Message</label>
          <textarea
            id="message"
            maxLength="1000"
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type your message..."
            rows="3"
            value={message}
          />
          <div className="form-footer">
            <span>{message.length}/1000</span>
            <button className="send-button" disabled={isLoading} type="submit">
              {isLoading ? "Sending..." : "Send message"}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>

        <form className="pdf-form" onSubmit={uploadDocument}>
          <h2>Summarize a document</h2>
          <p>
            Upload a PDF, TXT, MD, or CSV file up to 5 MB. Text is extracted,
            summarized, and used to answer follow-up questions.
          </p>
          <input
            accept=".pdf,.txt,.md,.csv,application/pdf,text/plain,text/markdown,text/csv"
            onChange={(event) => {
              setDocumentFile(event.target.files?.[0] || null);
              setDocumentResult(null);
              setError("");
            }}
            type="file"
          />
          {documentFile && (
            <p className="selected-file">Selected: {documentFile.name}</p>
          )}
          <button className="send-button" disabled={isDocumentLoading} type="submit">
            {isDocumentLoading ? "Analysing..." : "Upload and summarize"}
          </button>
          {documentResult && (
            <div className="pdf-result">
              <h3>{documentResult.filename}</h3>
              <p className="doc-stats">
                {documentResult.kind === "pdf" && documentResult.pages
                  ? `${documentResult.pages} pages · `
                  : ""}
                {documentResult.statistics.words} words ·{" "}
                {documentResult.statistics.readingMinutes} min read ·{" "}
                {providerLabel(documentResult.provider)}
              </p>
              <p>Document context is attached to this conversation.</p>
              <p>{documentResult.summary}</p>
              <strong>Important keywords</strong>
              <ul className="keyword-list">
                {documentResult.keywords.map((keyword) => (
                  <li key={keyword}>{keyword}</li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </section>
    </main>
  );
}

export default App;
