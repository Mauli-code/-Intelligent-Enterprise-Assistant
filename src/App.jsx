import React, { useEffect, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/chat$/, "")
  : "http://localhost:3001/api";

async function request(path, options) {
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "The server rejected the request.");
  }

  return data;
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
  }, []);

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
        { role: "assistant", text: data.reply },
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

  if (isHistoryLoading) {
    return <main className="app-shell"><p>Loading conversations...</p></main>;
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
              <li className={conversation.id === conversationId ? "selected" : ""} key={conversation.id}>
                <button type="button" onClick={() => openConversation(conversation.id)}>
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
            <button className="retry-button" onClick={() => sendMessage(null, failedMessage, true)} type="button">
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
