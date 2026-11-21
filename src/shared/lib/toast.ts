import { toast } from "solid-sonner";

interface ToastOptions {
  id?: string;
  description?: string;
}

/** Errors stay up until dismissed. */
export function toastError(message: string, options?: ToastOptions) {
  toast.error(message, { duration: Number.POSITIVE_INFINITY, ...options });
}
