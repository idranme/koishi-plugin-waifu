import { Universal } from 'koishi'

export function getMaxAge() {
    const currentTime = Date.now()
    const tomorrowMidnight = new Date()
    tomorrowMidnight.setHours(24, 0, 0, 0)
    return tomorrowMidnight.getTime() - currentTime
}

export function getMemberInfo(member: Universal.GuildMember, id: string) {
    const name = member?.nick || member?.user?.nick || member?.user?.name || id
    const avatar = member?.avatar || member?.user?.avatar
    return [name, avatar]
}