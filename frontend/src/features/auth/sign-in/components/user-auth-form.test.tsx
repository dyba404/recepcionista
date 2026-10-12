import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosResponse } from 'axios'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'

/**
 * Test del login REAL: POST /api/auth/login con guardia 401 inline
 * (contract docs/adr/0002-auth-websocket-persistencia.md).
 */

const FORM_MESSAGES = {
  emailEmpty: 'Escribe tu correo.',
  passwordEmpty: 'Escribe tu contraseña.',
  passwordShort: 'La contraseña debe tener al menos 8 caracteres.',
  badCredentials: 'Credenciales incorrectas',
} as const

const MOCK_TOKEN = 'jwt-demo-token'
const MOCK_USER = {
  id: 1,
  email: 'admin@demo.pe',
  nombre: 'Admin demo',
  tenant_id: 'faro',
  rol: 'owner',
} as const

const apiPostMock = vi.fn()
const navigate = vi.fn()
const setUserMock = vi.fn()
const setAccessTokenMock = vi.fn()

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    auth: {
      setUser: setUserMock,
      setAccessToken: setAccessTokenMock,
    },
  }),
}))

vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => navigate,
  }
})

async function renderForm(redirectTo?: string): Promise<RenderResult> {
  return await render(<UserAuthForm redirectTo={redirectTo} />)
}

function unauthorizedError(): AxiosError {
  const err = new AxiosError('Unauthorized', '401')
  err.response = { status: 401 } as AxiosResponse
  return err
}

describe('UserAuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiPostMock.mockResolvedValue({
      data: { access_token: MOCK_TOKEN, user: MOCK_USER },
    })
  })

  it('rendera campos, botón Entrar y las 2 cuentas demo', async () => {
    const screen = await renderForm()

    await expect
      .element(screen.getByRole('textbox', { name: /^Correo$/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByLabelText(/^Contraseña$/i))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /^Entrar$/i }))
      .toBeInTheDocument()
    // Cuentas demo del sandbox: owner primero, staff (cocina) después.
    await expect
      .element(screen.getByText('Admin demo'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('Cocina demo'))
      .toBeInTheDocument()
  })

  it('muestra mensajes de validación al enviar el formulario vacío', async () => {
    const screen = await renderForm()
    const entrar = screen.getByRole('button', { name: /^Entrar$/i })

    await userEvent.click(entrar)

    await expect
      .element(screen.getByText(FORM_MESSAGES.emailEmpty))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordEmpty))
      .toBeInTheDocument()
    expect(apiPostMock).not.toHaveBeenCalled()
  })

  it('muestra el mínimo de 8 caracteres en la contraseña', async () => {
    const screen = await renderForm()

    await userEvent.fill(
      screen.getByRole('textbox', { name: /^Correo$/i }),
      'admin@demo.pe'
    )
    await userEvent.fill(screen.getByLabelText(/^Contraseña$/i), 'abc')
    await userEvent.click(screen.getByRole('button', { name: /^Entrar$/i }))

    await expect
      .element(screen.getByText(FORM_MESSAGES.passwordShort))
      .toBeInTheDocument()
    expect(apiPostMock).not.toHaveBeenCalled()
  })

  it('loguea contra /api/auth/login y navega al inicio', async () => {
    const screen = await renderForm()

    await userEvent.fill(
      screen.getByRole('textbox', { name: /^Correo$/i }),
      'admin@demo.pe'
    )
    await userEvent.fill(
      screen.getByLabelText(/^Contraseña$/i),
      'demo1234'
    )
    await userEvent.click(screen.getByRole('button', { name: /^Entrar$/i }))

    expect(apiPostMock).toHaveBeenCalledWith(
      '/api/auth/login',
      { email: 'admin@demo.pe', password: 'demo1234' },
      expect.objectContaining({ skipAuthRedirect: true })
    )

    await vi.waitFor(() => expect(setUserMock).toHaveBeenCalledOnce())
    expect(setUserMock).toHaveBeenCalledWith(MOCK_USER)
    expect(setAccessTokenMock).toHaveBeenCalledOnce()
    expect(setAccessTokenMock).toHaveBeenCalledWith(MOCK_TOKEN)

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
    )
  })

  it('navega al redirectTo cuando viene en la URL', async () => {
    const screen = await renderForm('/panel')

    await userEvent.fill(
      screen.getByRole('textbox', { name: /^Correo$/i }),
      'cocina@demo.pe'
    )
    await userEvent.fill(
      screen.getByLabelText(/^Contraseña$/i),
      'demo1234'
    )
    await userEvent.click(screen.getByRole('button', { name: /^Entrar$/i }))

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/panel', replace: true })
    )
  })

  it('muestra error inline con 401 del backend (sin logout redirect)', async () => {
    apiPostMock.mockRejectedValueOnce(unauthorizedError())
    const screen = await renderForm()

    await userEvent.fill(
      screen.getByRole('textbox', { name: /^Correo$/i }),
      'admin@demo.pe'
    )
    await userEvent.fill(
      screen.getByLabelText(/^Contraseña$/i),
      'malaclave99'
    )
    await userEvent.click(screen.getByRole('button', { name: /^Entrar$/i }))

    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent(FORM_MESSAGES.badCredentials)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('aplica la cuenta demo owner con el botón Usar', async () => {
    const screen = await renderForm()
    const usar: Locator = screen
      .getByRole('button', { name: /^Usar$/i })
      .first()

    await userEvent.click(usar)

    await vi.waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith(
        '/api/auth/login',
        { email: 'admin@demo.pe', password: 'demo1234' },
        expect.objectContaining({ skipAuthRedirect: true })
      )
    )
  })
})
