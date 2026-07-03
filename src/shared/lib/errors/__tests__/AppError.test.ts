import { describe, it, expect } from 'vitest'
import {
  AppError,
  ChannelNotBoundError,
  PersonNotFoundError,
  SlackEventDuplicateError,
  LowConfidenceSkipError,
} from '../AppError'

describe('AppError', () => {
  it('is an Error instance', () => {
    const err = new AppError('TEST_CODE', 'error', 'test message')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('TEST_CODE')
    expect(err.severity).toBe('error')
    expect(err.message).toBe('test message')
  })
})

describe('ChannelNotBoundError', () => {
  it('has correct code and severity', () => {
    const err = new ChannelNotBoundError()
    expect(err.code).toBe('CHANNEL_NOT_BOUND')
    expect(err.severity).toBe('warning')
  })
})

describe('PersonNotFoundError', () => {
  it('includes channelId in message', () => {
    const err = new PersonNotFoundError('C123')
    expect(err.code).toBe('PERSON_NOT_FOUND')
    expect(err.message).toContain('C123')
  })
})

describe('SlackEventDuplicateError', () => {
  it('has info severity', () => {
    const err = new SlackEventDuplicateError('Ev123')
    expect(err.severity).toBe('info')
  })
})

describe('LowConfidenceSkipError', () => {
  it('has info severity for BKT skip', () => {
    const err = new LowConfidenceSkipError()
    expect(err.code).toBe('LOW_CONFIDENCE_SKIP')
    expect(err.severity).toBe('info')
  })
})
