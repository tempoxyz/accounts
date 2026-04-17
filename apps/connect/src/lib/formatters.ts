export namespace TimeFormatter {
  export function formatExpirable(seconds: number): string {
    if (seconds <= 0) return 'Expired'
    if (seconds >= 86_400) {
      const days = Math.round(seconds / 86_400)
      return `${days} ${days === 1 ? 'day' : 'days'}`
    }
    if (seconds >= 3_600) {
      const hours = Math.round(seconds / 3_600)
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
    }
    const minutes = Math.max(1, Math.round(seconds / 60))
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }

  export function formatPeriod(seconds: number): string {
    if (seconds >= 86_400)
      return seconds === 86_400 ? 'day' : `${Math.round(seconds / 86_400)} days`
    if (seconds >= 3_600) return seconds === 3_600 ? 'hour' : `${Math.round(seconds / 3_600)} hours`
    return seconds === 60 ? 'minute' : `${Math.round(seconds / 60)} minutes`
  }
}
