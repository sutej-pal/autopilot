"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "../lib/api";

export function TokenForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await apiFetch("/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) {
      setError("That token was not accepted.");
      return;
    }
    onUnlocked();
  }

  return (
    <form className="card" onSubmit={submit}>
      <p>Enter the access token from the Render service environment.</p>
      <div className="row">
        <input aria-label="Access token" type="password" value={token} onChange={(event) => setToken(event.target.value)} />
        <button className="primary" type="submit">Unlock</button>
      </div>
      {error ? <p>{error}</p> : null}
    </form>
  );
}
