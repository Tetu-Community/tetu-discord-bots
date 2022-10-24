// const axios = require('axios')
const delay = require('delay')
const ms = require('ms')
const { Client } = require('discord.js')
const StatusUpdater = require('@tmware/status-rotate')
// const ethers = require('ethers')

function newClientWithStatusUpdater (key) {
  const bot = new Client({ intents: [] })
  bot.statusUpdater = new StatusUpdater(bot)
  bot.login(key)
  return bot
}

async function updateStatus (bot, guild, nickname, statusMsg) {
  if (statusMsg.length > 128) {
    statusMsg = statusMsg.substring(0, 128)
  }

  if (nickname) {
    const botUser = await guild.members.fetch(bot.user.id)
    botUser.setNickname(nickname)
  }

  const s = { type: 'WATCHING', name: statusMsg }
  await bot.statusUpdater.addStatus(s)
  await bot.statusUpdater.updateStatus(s)
}

async function runTetuPriceBot () {
  const bot = newClientWithStatusUpdater(process.env.TETU_PRICE_BOT_KEY)
  const guild = await bot.guilds.fetch(process.env.GUILD_ID)
  if (!guild) throw new Error('cannot find guild')

  bot.once('ready', loop)

  async function loop () {
    await updateStatus(bot, guild, 'foo', 'bar')
    await delay(ms('1m'))
    loop()
  }
}

async function main () {
  runTetuPriceBot()
}

main()
