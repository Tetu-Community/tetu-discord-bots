const axios         = require('axios')
const delay         = require('delay')
const ms            = require('ms')
const { Client }    = require('discord.js')
const StatusUpdater = require('@tmware/status-rotate')
const BigNumber     = require('bignumber.js')
const ethers        = require('ethers')
const reject        = require('lodash.reject')

const dotenv = require('dotenv');
dotenv.config();

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

function truncateErr (err) {
  return (err || '').toString().substring(0, 128)
}

function getProvider (network) {
  const urlStr = process.env[`${network.toUpperCase()}_RPC_HTTP`]
  if (!urlStr) {
    throw new Error(`no RPC provider for network ${network} found!`)
  }
  return jsonRpcProviderFromUrl(urlStr)
}

function jsonRpcProviderFromUrl (urlStr) {
  const u = new URL(urlStr)
  return new ethers.providers.JsonRpcProvider({
    url: u.origin + u.pathname,
    user: u.username,
    password: u.password,
  })
}

async function balancerPriceQuote ({ provider, poolId, inputToken, outputToken, inputAmount }) {
  const contract = new ethers.Contract(
    '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    require('./abis/BalancerVault.json'),
    provider,
  )

  const swap0 = {
    poolId,
    assetInIndex: 0,
    assetOutIndex: 1,
    amount: inputAmount,
    userData: '0x',
  }

  const assets = [
    inputToken,
    outputToken,
  ]

  const funds = {
    sender: ADDRESS_ZERO,
    fromInternalBalance: false,
    recipient: ADDRESS_ZERO,
    toInternalBalance: false,
  }

  const quote = await contract.callStatic.queryBatchSwap(0, [swap0], assets, funds)

  return BigNumber(quote[1].toString()).absoluteValue().toFixed(0)
}

async function tetuSwapPriceQuote ({ provider, router, pair, fee, inputToken, outputToken, inputAmount }) {
  const routerContract = new ethers.Contract(
    router,
    require('./abis/TetuSwapRouter.json'),
    provider,
  )

  const pairContract = new ethers.Contract(
    pair,
    require('./abis/UniswapV2Pair.json'),
    provider,
  )

  const reserves = await pairContract.getReserves()

  const inputTokenIsReserveZero = ethers.BigNumber.from(inputToken).lt(outputToken)

  const res = await routerContract.getAmountOut(
    inputAmount,
    inputTokenIsReserveZero ? reserves[0] : reserves[1],
    inputTokenIsReserveZero ? reserves[1] : reserves[0],
    fee,
  )

  return res.toString()
}

async function newClientWithStatusUpdater (key) {
  const bot         = new Client({ intents: [] })
  bot.statusUpdater = new StatusUpdater(bot)
  bot.login(key)

  const guilds = []

  for (const guildId of process.env.GUILD_IDS.split(',')) {
    try {
      const guild = await bot.guilds.fetch(guildId)
      if (!guild) {
        throw new Error('cannot find guild with id', guildId)
      }
      guilds.push(guild)
    } catch (err) {
      console.log('could not find guild', truncateErr(err))
    }
  }

  return [bot, guilds]
}

async function updateStatus (bot, guilds, nickname, statusMsg) {
  if (statusMsg.length > 128) {
    statusMsg = statusMsg.substring(0, 128)
  }

  if (process.env.VERBOSE) {
    console.log('updating bot', nickname, statusMsg)
  }

  if (nickname) {
    for (const guild of guilds) {
      const botUser = await guild.members.fetch(bot.user.id)
      botUser.setNickname(nickname)
    }
  }

  const s = { type: 3, name: statusMsg }
  await bot.statusUpdater.addStatus(s)
  await bot.statusUpdater.updateStatus(s)
}

async function runTetuPriceBot () {
  const [bot, guilds] = await newClientWithStatusUpdater(process.env.TETU_PRICE_BOT_KEY)
  bot.once('ready', loop)

  async function loop () {
    try {
      const resp = await axios.get('https://api.coingecko.com/api/v3/coins/tetu')
      await updateStatus(
        bot,
        guilds,
        `TETU $${resp.data.market_data.current_price.usd}`,
        `24h: ${BigNumber(resp.data.market_data.price_change_percentage_24h_in_currency.usd).toFixed(1)}%`,
      )
    } catch (err) {
      console.log('error in runTetuPriceBot', truncateErr(err))
    }

    await delay(ms('2m'))
    loop()
  }
}

async function runTetuCirculatingSupplyBot () {
  const [bot, guilds] = await newClientWithStatusUpdater(process.env.TETU_CIRCULATING_SUPPLY_BOT_KEY)
  bot.once('ready', loop)

  async function loop () {
    try {
      const resp = await axios.get('https://api.tetu.io/api/v1/info/circulationSupply')
      await updateStatus(
        bot,
        guilds,
        BigNumber(resp.data).toFormat(2),
        'Circulating Supply',
      )
    } catch (err) {
      console.log('error in runTetuCirculatingSupplyBot', truncateErr(err))
    }

    await delay(ms('5m'))
    loop()
  }
}

async function runTetuBalDiscountBot () {
  const [bot, guilds] = await newClientWithStatusUpdater(process.env.TETU_BAL_DISCOUNT_BOT_KEY)
  bot.once('ready', loop)

  async function loop () {
    try {
      const resp = await balancerPriceQuote({
        provider: getProvider('polygon'),
        poolId: '0x7af62c1ebf97034b7542ccec13a2e79bbcf34380000000000000000000000c13',
        inputToken: '0x7fc9e0aa043787bfad28e29632ada302c790ce33',
        outputToken: '0x3d468ab2329f296e1b9d8476bb54dd77d8c2320f',
        inputAmount: ethers.utils.parseEther('1'),
      })

      const bptForTetuBal = BigNumber(resp.toString()).shiftedBy(-18)
      const discount      = BigNumber(1).minus(bptForTetuBal)

      await updateStatus(
        bot,
        guilds,
        `${bptForTetuBal.toFixed(4)} (${discount.times(100).toFixed(1)}%)`,
        'tetuBAL discount',
      )
    } catch (err) {
      console.log('error in runTetuBalDiscountBot', truncateErr(err))
    }

    await delay(ms('5m'))
    loop()
  }
}

async function runTetuQiDiscountBot () {
  const [bot, guilds] = await newClientWithStatusUpdater(process.env.TETU_QI_DISCOUNT_BOT_KEY)
  bot.once('ready', loop)

  async function loop () {
    try {
      const resp = await balancerPriceQuote({
        provider: getProvider('polygon'),
        poolId: '0xd80ef9fabfdc3b52e17f74c383cf88ee2efbf0b6000000000000000000000a65',
        inputToken: '0x4cd44ced63d9a6fef595f6ad3f7ced13fceac768',
        outputToken: '0x580a84c73811e1839f75d86d75d88cca0c241ff4',
        inputAmount: ethers.utils.parseEther('1'),
      })

      const qiForTetuQi = BigNumber(resp.toString()).shiftedBy(-18)
      const discount    = BigNumber(1).minus(qiForTetuQi)

      await updateStatus(
        bot,
        guilds,
        `${qiForTetuQi.toFixed(4)} (${discount.times(100).toFixed(1)}%)`,
        'tetuQI discount',
      )
    } catch (err) {
      console.log('error in runTetuQiDiscountBot', truncateErr(err))
    }

    await delay(ms('5m'))
    loop()
  }
}

async function runTetuTvlBot () {
  const [bot, guilds] = await newClientWithStatusUpdater(process.env.TETU_TVL_BOT_KEY)
  bot.once('ready', loop)

  async function loop () {
    try {
      const resp = await axios.get('https://api.llama.fi/protocol/tetu')

      let tvl = 0;

      Object.values(resp.data.currentChainTvls).forEach(t => tvl += Number(t));

      await updateStatus(
        bot,
        guilds,
        '$' + BigNumber(tvl).toFormat(0),
        'TVL',
      )
    } catch (err) {
      console.log('error in runTetuCirculatingSupplyBot', truncateErr(err))
    }

    await delay(ms('5m'))
    loop()
  }
}

setTimeout(runTetuPriceBot, 0)
setTimeout(runTetuCirculatingSupplyBot, 0)
setTimeout(runTetuBalDiscountBot, 0)
//setTimeout(runTetuQiDiscountBot, 0)
setTimeout(runTetuTvlBot, 0)
