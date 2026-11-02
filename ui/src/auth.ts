export interface AuthUser {
  email: string
  fullName: string
  organisation: string
  designation: string
  role: "viewer" | "planner" | "admin"
}

interface AuthResponse {
  user?: AuthUser
  error?: string
}

const AUTH_BASE = `${(import.meta.env.VITE_EXPRESS_API_BASE_URL || "/api").replace(/\/$/, "")}/auth`

async function request(path: string, method: "GET" | "POST", body?: unknown): Promise<AuthResponse> {
  let response: Response
  try {
    response = await fetch(`${AUTH_BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Cannot reach the SupplyShield backend. Start the server and check the frontend /api proxy target.")
    }
    throw error
  }
  let payload: AuthResponse
  try {
    payload = (await response.json()) as AuthResponse
  } catch {
    throw new Error(`The SupplyShield backend returned an invalid response (HTTP ${response.status}). Check its startup logs.`)
  }
  if (!response.ok) {
    const error = new Error(payload.error || `Authentication request failed (${response.status})`)
    Object.assign(error, { status: response.status })
    throw error
  }
  return payload
}

export async function getSession(): Promise<AuthUser | null> {
  try {
    const response = await request("/session", "GET")
    return response.user ?? null
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 401) return null
    throw error
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const response = await request("/login", "POST", { email, password })
  if (!response.user) throw new Error("The server did not return an authenticated user.")
  return response.user
}

export async function signup(input: {
  fullName: string
  email: string
  password: string
}): Promise<AuthUser> {
  const response = await request("/signup", "POST", input)
  if (!response.user) throw new Error("The server did not return an authenticated user.")
  return response.user
}

export async function logout(): Promise<void> {
  await request("/logout", "POST", {})
}
