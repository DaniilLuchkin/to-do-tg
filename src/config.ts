// Client-side configuration for the Donate and Feedback flows. All values are
// read from CONFIG — do not hardcode them elsewhere. Any empty-string field is
// hidden gracefully in the UI (no dead buttons).

export type DonateStarTier = { label: string; stars: number; link: string }
export type CryptoAddress = { name: string; ticker: string; address: string }

export type AppConfig = {
  donateStars: DonateStarTier[]
  crypto: CryptoAddress[]
  feedbackTelegram: string
  feedbackEmail: string
}

export const CONFIG: AppConfig = {
  // Telegram Stars donation tiers. Empty link = tier hidden (links added later).
  donateStars: [
    { label: 'Coffee', stars: 50, link: 'https://t.me/$5dLqUUG-AUopFwAAe41XLnj9KJU' },
    { label: 'Support', stars: 150, link: 'https://t.me/$ihKGVkG-AUorFwAAeuY0_KaBsX4' },
    { label: 'Generous', stars: 500, link: 'https://t.me/$sg3770G-AUosFwAAHMSSS0eiulQ' },
  ],
  // Crypto donation addresses (grouped by network; network shown in `name`).
  crypto: [
    {
      name: 'Bitcoin',
      ticker: 'BTC',
      address: 'bc1qqlgwm69tl30far7usyxcm6k3jeslramzvmm5vd',
    },
    {
      name: 'Ethereum',
      ticker: 'ETH',
      address: '0x7a4e5FB4436f17f034BfF521280c83C51f888C17',
    },
    {
      name: 'USDT (ERC-20)',
      ticker: 'USDT·ERC20',
      address: '0x7a4e5FB4436f17f034BfF521280c83C51f888C17',
    },
    {
      name: 'Gram (prev. Toncoin)',
      ticker: 'GRAM',
      address: 'UQDeySwVTWCYunf2vwY3xTvzzADDTst9FeNFwDuSLIrZm_KP',
    },
    {
      name: 'USDT (TON network)',
      ticker: 'USDT·TON',
      address: 'UQDeySwVTWCYunf2vwY3xTvzzADDTst9FeNFwDuSLIrZm_KP',
    },
  ],
  // Feedback channels.
  feedbackTelegram: 'https://t.me/daniilluchkin',
  feedbackEmail: 'Luchkin.Dany@gmail.com',
}
