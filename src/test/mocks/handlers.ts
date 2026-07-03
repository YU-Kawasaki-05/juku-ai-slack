import { http, HttpResponse } from 'msw'

export const handlers = [
  http.post('https://slack.com/api/*', () => {
    return HttpResponse.json({ ok: true })
  }),
]
