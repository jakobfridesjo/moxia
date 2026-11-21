import { QueryClient } from "@tanstack/solid-query";

// Commands run in-process: a failure is a real error, so retrying only delays the message.
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
      },
    },
  });
}
