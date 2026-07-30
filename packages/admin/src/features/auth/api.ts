import { apiRequest } from "../../shared/api/apiClient";

// feature가 자신의 endpoint와 contract를 소유한다
// (docs/06-architecture.md "Frontend").

export type Admin = {
  id: string;
  email: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export function login(input: LoginInput): Promise<{ admin: Admin }> {
  return apiRequest<{ admin: Admin }>("/auth/login", {
    method: "POST",
    body: input,
  });
}

export function fetchCurrentAdmin(): Promise<{ admin: Admin }> {
  return apiRequest<{ admin: Admin }>("/auth/me");
}

export function logout(): Promise<unknown> {
  return apiRequest("/auth/logout", { method: "POST" });
}
