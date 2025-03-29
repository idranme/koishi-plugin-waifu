export function getMaxAge() {
    const currentTime = Date.now()
    const tomorrowMidnight = new Date()
    tomorrowMidnight.setHours(24, 0, 0, 0)
    return tomorrowMidnight.getTime() - currentTime
}