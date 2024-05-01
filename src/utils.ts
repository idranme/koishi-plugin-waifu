export function randomSelect<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]
}

export function isSameDay(timestamp1: number, timestamp2: number): boolean {
    const date1 = new Date(timestamp1)
    const date2 = new Date(timestamp2)
    return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
    )
}

export function getMaxAge() {
    const currentTime = Date.now()
    const tomorrowMidnight = new Date()
    tomorrowMidnight.setHours(24, 0, 0, 0)
    return tomorrowMidnight.getTime() - currentTime
}