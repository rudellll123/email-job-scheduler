import { useAuth } from './auth/AuthContext'
import LoginPage from './pages/LoginPage'

export default function App() {
  const { user, loading, logout } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading...
      </div>
    )
  }

  if (!user) return <LoginPage />

  // Temporary placeholder so we can verify the login flow. Replaced by the real dashboard next.
  return (
    <div className="p-8">
      <div className="flex items-center gap-3">
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-10 w-10 rounded-full"
          />
        )}
        <div>
          <p className="font-medium text-gray-900">{user.name}</p>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <button
          onClick={() => void logout()}
          className="ml-4 rounded-md border border-green-600 px-3 py-1.5 text-sm text-green-700 hover:bg-green-50"
        >
          Logout
        </button>
      </div>
    </div>
  )
}
