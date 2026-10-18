// How a saved date (YYYY-MM-DD) reads in text Larder writes for people: "28 Oct 2026".
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const day = (d: string) => { const [y, m, dd] = d.split('-'); return `${months[Number(m) - 1]} ${Number(dd)}, ${y}` }
