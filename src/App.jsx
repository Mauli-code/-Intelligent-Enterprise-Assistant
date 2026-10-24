import { useState } from "react";

const apiUrl =
  import.meta.env.VITE_API_URL || "http://localhost:3001/api/chat";

function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [failedMessage, setFailedMessage] = useState("");

  async function sendMessage(event, messageToSend = message, isRetry = false) {
    event?.preventDefault();
    const trimmedMessage = messageToSend.trim();

    if (!trimmedMessage || isLoading) {
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
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmedMessage }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "The server rejected your message.");
      }

      setMessages((currentMessages) => [
        ...currentMessages,
        { role: "assistant", text: data.reply },
      ]);
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

  return (
    <main className="app-shell">
      <section className="chat-card" aria-label="Intelligent Enterprise Assistant">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Day 1 prototype</p>
            <h1>Intelligent Enterprise Assistant</h1>
            <p className="subtitle">Ask a question to start a conversation.</p>
          </div>
          <button className="secondary-button" type="button" onClick={clearChat}>
            Clear chat
          </button>
        </header>

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <p className="empty-state">Your messages and assistant replies will appear here.</p>
          ) : (
            messages.map((chatMessage, index) => (
              <div className={`message ${chatMessage.role}`} key={`${chatMessage.role}-${index}`}>
                <span>{chatMessage.role === "user" ? "You" : "Assistant"}</span>
                <p>{chatMessage.text}</p>
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
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </section>
    </main>
  );
}

export default App;
