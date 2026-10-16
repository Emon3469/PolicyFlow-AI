"use client";

import { useCallback, useSyncExternalStore } from "react";
import useSWR from "swr";
import { fetcher } from "./api";
import type { DocumentList, Health, LogPage, Stats } from "./types";

const steadyRetry = {
  onErrorRetry: (_error: unknown, _key: string, _config: unknown, revalidate: (opts: { retryCount: number }) => void, { retryCount }: { retryCount: number }) => {
    setTimeout(() => revalidate({ retryCount }), 4000);
  },
};

export function useHealth() {
  return useSWR<Health>("/api/health", fetcher, {
    refreshInterval: (data) => (data?.knowledge_base.status === "ready" ? 30000 : 4000),
    revalidateOnFocus: true,
    ...steadyRetry,
  });
}

export function useStats() {
  return useSWR<Stats>("/api/stats", fetcher, { refreshInterval: 20000, ...steadyRetry });
}

export function useDocuments() {
  return useSWR<DocumentList>("/api/documents", fetcher, steadyRetry);
}

export function useLogs(page: number, pageSize: number, source: string | null) {
  const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
  if (source) params.set("source", source);
  return useSWR<LogPage>(`/api/logs?${params}`, fetcher, { keepPreviousData: true, refreshInterval: 30000, ...steadyRetry });
}

const ADMIN_STORAGE_KEY = "policyflow.admin-key";
const listeners = new Set<() => void>();

function readAdminKey() {
  try {
    return sessionStorage.getItem(ADMIN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function useAdminKey() {
  const key = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readAdminKey,
    () => "",
  );
  const setKey = useCallback((value: string) => {
    try {
      if (value) sessionStorage.setItem(ADMIN_STORAGE_KEY, value);
      else sessionStorage.removeItem(ADMIN_STORAGE_KEY);
    } catch {}
    listeners.forEach((listener) => listener());
  }, []);
  return [key, setKey] as const;
}
