export interface User {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

export interface MeResponse {
  authenticated: boolean
  user: User | null
}

export interface MessageResponse {
  message: string
}
