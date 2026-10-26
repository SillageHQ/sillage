import { useQuery } from "@tanstack/react-query";
import { API_URL as API } from "@/lib/api";
import type { UserProfile } from "@/App";

export function useAccountProfileQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["account", "profile"],
    queryFn: async (): Promise<{ user: UserProfile } | null> => {
      const response = await fetch(`${API}/v1/account/profile`);
      if (!response.ok) return null;
      return response.json() as Promise<{ user: UserProfile }>;
    },
    enabled,
    retry: false,
  });
}
