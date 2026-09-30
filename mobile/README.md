# Pi AI

A private AI chat app for your phone. The AI (Ollama) runs on your Raspberry Pi, and this Expo app talks to it over your home Wi-Fi or Tailscale. Nothing is sent to an outside AI company.

- Replies stream in word by word, with a Stop button
- Pick any model installed on the Pi
- Set a "personality" (system prompt)
- Follows your phone's light/dark mode

## 1. Install Ollama on the Pi

Ollama needs the **64-bit** Raspberry Pi OS. Check with `uname -m`; it should print `aarch64`.

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

This installs Ollama as a system service called `ollama` that starts on boot.

## 2. Let your phone reach it

Out of the box, Ollama only accepts connections from the Pi itself. Open it up to your network:

```bash
sudo systemctl edit ollama
```

In the editor, add these lines in the blank area near the top, then save and exit:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
```

```bash
sudo systemctl restart ollama
```

From your phone's browser, open `http://10.0.10.144:11434` (your Pi's IP). It should say **Ollama is running**.

## 3. Download a model

A Pi 4 has no GPU, so small models work best. Jellyfin also needs some RAM.

| Pi 4 RAM | Model | Command | Download size |
| --- | --- | --- | --- |
| 2 GB | Qwen 2.5 0.5B | `ollama pull qwen2.5:0.5b` | ~400 MB |
| 4 GB | Llama 3.2 1B (recommended) | `ollama pull llama3.2:1b` | ~1.3 GB |
| 8 GB | Llama 3.2 3B | `ollama pull llama3.2:3b` | ~2 GB |

Try it on the Pi first: `ollama run llama3.2:1b` (type `/bye` to exit).

Expect a 1B model to answer at a few words per second. 3B models are smarter but noticeably slower. The first message after a while takes longer because the model has to load into memory.

## 4. Run the app on your phone

1. Install **Expo Go** from the App Store or Google Play.
2. On a computer (or the Pi) with [Node.js](https://nodejs.org) 22 LTS (20.19+ also works):
   ```bash
   cd Homelab-website/mobile
   npm install
   npx expo start
   ```
3. Scan the QR code: with the Camera app on iPhone, or from inside Expo Go on Android.

Your phone and that computer need to be on the same Wi-Fi. If the QR code won't connect, use `npx expo start --tunnel` instead.

## 5. Connect the app

The Settings screen opens on first launch. Enter the Pi's address and tap **Test connection**:

- At home: `http://10.0.10.144:11434`
- Anywhere, over Tailscale: `http://100.x.x.x:11434` (find it on the Pi with `tailscale ip -4`)

You can type just the IP; the app fills in `http://` and `:11434` for you. Pick a model and tap **Save**.

## Security

Ollama has no password. Anyone who can reach port 11434 can use it.

- Keep it on your home network and Tailscale.
- **Don't** port-forward 11434 on your router, and don't point www.gabe-server.com at it.

## Development

```bash
npm run typecheck
npm run lint
```

The app is plain Expo (SDK 57) with no custom native code, so it runs in Expo Go. `app.json` already allows plain-HTTP connections, which you'd need if you later build a standalone app with EAS.
