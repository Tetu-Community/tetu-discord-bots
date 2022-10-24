const axios = require('axios')
const delay = require('delay')
const ms = require('ms')
const { Client } = require('discord.js')
const StatusUpdater = require('@tmware/status-rotate')
const BigNumber = require('bignumber.js')
const ethers = require('ethers')

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

function getProvider (network) {
  const urlStr = process.env[`${network.toUpperCase()}_RPC_HTTP`]
  if (!urlStr) throw new Error(`no RPC provider for network ${network} found!`)
  return jsonRpcProviderFromUrl(urlStr)
}

function jsonRpcProviderFromUrl (urlStr) {
  const u = new URL(urlStr)
  return new ethers.providers.JsonRpcProvider({
    url: u.origin + u.pathname,
    user: u.username,
    password: u.password
  })
}

async function balancerPriceQuote ({ provider, poolId, inputToken, outputToken, inputAmount }) {
  const contract = new ethers.Contract(
    '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    require('./abis/BalancerVault.json'),
    provider
  )

  const swap0 = {
    poolId,
    assetInIndex: 0,
    assetOutIndex: 1,
    amount: inputAmount,
    userData: '0x'
  }

  const assets = [
    inputToken,
    outputToken
  ]

  const funds = {
    sender: ADDRESS_ZERO,
    fromInternalBalance: false,
    recipient: ADDRESS_ZERO,
    toInternalBalance: false
  }

  const quote = await contract.callStatic.queryBatchSwap(0, [swap0], assets, funds)

  return BigNumber(quote[1].toString()).absoluteValue().toFixed(0)
}

async function tetuSwapPriceQuote ({ provider, router, pair, fee, inputToken, outputToken, inputAmount }) {
  const routerContract = new ethers.Contract(
    router,
    require('./abis/TetuSwapRouter.json'),
    provider
  )

  const pairContract = new ethers.Contract(
    pair,
    require('./abis/UniswapV2Pair.json'),
    provider
  )

  const reserves = await pairContract.getReserves()

  const inputTokenIsReserveZero = ethers.BigNumber.from(inputToken).lt(outputToken)

  const res = await routerContract.getAmountOut(
    inputAmount,
    inputTokenIsReserveZero ? reserves[0] : reserves[1],
    inputTokenIsReserveZero ? reserves[1] : reserves[0],
    fee
  )

  return res.toString()
}

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
    try {
      const resp = await axios.get('https://api.coingecko.com/api/v3/coins/tetu')
      await updateStatus(
        bot,
        guild,
        `TETU $${resp.data.market_data.current_price.usd}`,
        `24h: ${BigNumber(resp.data.market_data.price_change_percentage_24h_in_currency.usd).toFixed(1)}%`
      )
    } catch (err) {
      console.log('error updating tetu price bot', err)
    }

    await delay(ms('1m'))
    loop()
  }
}

async function runTetuCirculatingSupplyBot () {
  const bot = newClientWithStatusUpdater(process.env.TETU_CIRCULATING_SUPPLY_BOT_KEY)
  const guild = await bot.guilds.fetch(process.env.GUILD_ID)
  if (!guild) throw new Error('cannot find guild')
  bot.once('ready', loop)

  async function loop () {
    try {
      const resp = await axios.get('https://api.tetu.io/api/v1/info/circulationSupply')
      await updateStatus(
        bot,
        guild,
        BigNumber(resp.data).toFormat(2),
        'Circulating Supply'
      )
    } catch (err) {
      console.log('error updating tetu circulatung supply bot', err)
    }

    await delay(ms('1m'))
    loop()
  }
}

async function runTetuBalDiscountBot () {
  const bot = newClientWithStatusUpdater(process.env.TETU_BAL_DISCOUNT_BOT_KEY)
  const guild = await bot.guilds.fetch(process.env.GUILD_ID)
  if (!guild) throw new Error('cannot find guild')
  bot.once('ready', loop)

  async function loop () {
    try {
      const resp = await balancerPriceQuote({
        provider: getProvider('polygon'),
        poolId: '0xb797adfb7b268faeaa90cadbfed464c76ee599cd0002000000000000000005ba',
        inputToken: '0x7fc9e0aa043787bfad28e29632ada302c790ce33',
        outputToken: '0x3d468ab2329f296e1b9d8476bb54dd77d8c2320f',
        inputAmount: ethers.utils.parseEther('1')
      })

      const bptForTetuBal = BigNumber(resp.toString()).shiftedBy(-18)
      const discount = BigNumber(1).minus(bptForTetuBal)
      console.log(discount.toString())

      await updateStatus(
        bot,
        guild,
        `${bptForTetuBal.toFixed(4)} (${discount.times(100).toFixed(1)}%)`,
        'tetuBAL discount'
      )
    } catch (err) {
      console.log('error updating tetu circulatung supply bot', err)
    }

    await delay(ms('1m'))
    loop()
  }
}

async function runTetuQiDiscountBot () {
  const bot = newClientWithStatusUpdater(process.env.TETU_BAL_DISCOUNT_BOT_KEY)
  const guild = await bot.guilds.fetch(process.env.GUILD_ID)
  if (!guild) throw new Error('cannot find guild')
  bot.once('ready', loop)

  async function loop () {
    try {
      const resp = await tetuSwapPriceQuote({
        provider: getProvider('polygon'),
        router: '0xBCA055F25c3670fE0b1463e8d470585Fe15Ca819',
        fee: 10,
        pair: '0xbcdd0e38f759f8c07d8416df15d0b3e0f9146d08',
        inputToken: '0x4cd44ced63d9a6fef595f6ad3f7ced13fceac768',
        outputToken: '0x580a84c73811e1839f75d86d75d88cca0c241ff4',
        inputAmount: ethers.utils.parseEther('1')
      })

      const qiForTetuQi = BigNumber(resp.toString()).shiftedBy(-18)
      const discount = BigNumber(1).minus(qiForTetuQi)
      console.log(discount.toString())

      await updateStatus(
        bot,
        guild,
        `${qiForTetuQi.toFixed(4)} (${discount.times(100).toFixed(1)}%)`,
        'tetuQI discount'
      )
    } catch (err) {
      console.log('error updating tetu circulatung supply bot', err)
    }

    await delay(ms('1m'))
    loop()
  }
}

async function main () {
  runTetuPriceBot()
  runTetuCirculatingSupplyBot()
  runTetuBalDiscountBot()
  runTetuQiDiscountBot()
}

main()
