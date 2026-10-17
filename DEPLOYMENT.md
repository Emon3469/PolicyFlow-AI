# Deployment Guide

Backend (FastAPI, Docker) goes on **Render**. Frontend (Next.js) goes on **Vercel**.
Deploy the backend first, because the frontend needs the backend URL.

---

## Before you start

- [ ] Code is pushed to GitHub (`Emon3469/PolicyFlow-AI`, branch `main`).
- [ ] You have at least one LLM key (Groq, OpenAI, Anthropic or Gemini).
- [ ] You have a **Pinecone** API key (needed for retrieval) and a **Tavily** key (web search, optional).
- [ ] Accounts on [render.com](https://render.com) and [vercel.com](https://vercel.com), both signed in with GitHub.

---

## Part 1: Backend on Render

1. **Open Blueprints.** Render dashboard → **New +** → **Blueprint**.
   *A Blueprint reads `render.yaml` from the repo and creates the service for you.*

2. **Connect the repo.** Pick `Emon3469/PolicyFlow-AI`. If it is not listed, click **Configure account** and give Render access to it.

3. **Name the Blueprint** (anything, e.g. `policyflow`) and keep branch `main`.

4. **Fill the secret values** Render asks for:

   | Key | What to put |
   | --- | --- |
   | `CORS_ORIGINS` | Put `http://localhost:3000` for now. You change it in Part 3. |
   | `GROQ_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | Your keys. Leave a box **empty** if you don't have that provider. |
   | `PINECONE_API_KEY` | Your Pinecone key. |
   | `TAVILY_API_KEY` | Your Tavily key, or empty. |

   *`ADMIN_API_KEY` is generated automatically. `CORS_ORIGIN_REGEX` is pre-set so Vercel URLs are allowed.*

5. **Click Apply.** Render builds the Docker image from `backend/Dockerfile`. The first build takes **5–10 minutes** because it downloads the embedding model.

6. **Check that it works.** Open the service and copy its URL (looks like `https://policyflow-ai-api.onrender.com`). Visit:

   ```
   https://policyflow-ai-api.onrender.com/api/health
   ```

   You should get a JSON response. **Copy this base URL**, without `/api/health` and without a trailing `/`.

> **Free plan note:** the service sleeps after 15 min idle, and the first request after that takes ~1 minute. Uploaded files and the SQLite log reset on each redeploy, because the free plan has no persistent disk.

---

## Part 2: Frontend on Vercel

1. **Import the project.** Vercel dashboard → **Add New…** → **Project** → import `Emon3469/PolicyFlow-AI`.

2. **Set Root Directory to `frontend`.** Click **Edit** next to *Root Directory* and pick `frontend`.
   *This is the most common mistake. If you skip it, the build fails with "No Next.js version detected".*

3. **Framework preset:** Vercel detects **Next.js** on its own. Leave the build and output settings at their defaults.

4. **Add the environment variable** (under *Environment Variables*):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | Your Render URL from Part 1, e.g. `https://policyflow-ai-api.onrender.com` |

   *No trailing `/`. It must start with `https://`.*

5. **Click Deploy.** It takes about 1–2 minutes. Then copy your Vercel URL (e.g. `https://policyflow-ai.vercel.app`).

---

## Part 3: Connect them (CORS)

1. Render → your service → **Environment** → edit `CORS_ORIGINS`:

   ```
   https://policyflow-ai.vercel.app,http://localhost:3000
   ```

   *Use your real Vercel URL, with no trailing `/`. Separate entries with commas and no spaces.*

2. **Save Changes.** Render redeploys by itself (a few minutes).

3. Open your Vercel URL and ask a question in **Assistant**. The answer should stream in.

---

## Common errors

| Symptom | Fix |
| --- | --- |
| Browser console shows **CORS error** | `CORS_ORIGINS` on Render doesn't exactly match the Vercel URL (check `https`, no trailing `/`). Save and wait for the redeploy. |
| Frontend calls `localhost:8000` | `NEXT_PUBLIC_API_URL` was missing at build time. Add it in Vercel, then go to **Deployments** → **⋯** → **Redeploy**. *Changing the variable alone does nothing until you redeploy.* |
| Vercel: "No Next.js version detected" | Root Directory is not `frontend`. Fix it in **Settings → Build and Deployment**. |
| First request takes about 1 minute | Free Render instance waking up. This is normal. |
| Render build "Out of memory" | Upgrade the instance to *Starter*, or retry. The free plan has 512 MB. |
| Answers say no LLM available | None of the LLM key fields on Render has a value. Add at least one and save. |
| Upload / delete returns 401 | Those routes need `ADMIN_API_KEY`. Find it under Render → **Environment** and enter it in the app's **Settings** page. |

---

## Updating later

Push to `main`. Render redeploys only when files in `backend/` (or `render.yaml`) change, and Vercel redeploys on every push.

## Run the whole stack locally with Docker (optional)

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

Web: http://localhost:3000 · API: http://localhost:8000/docs
