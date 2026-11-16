export function receiptItems(receipt){
 return Array.isArray(receipt?.items)
  ?receipt.items.filter(item=>typeof item?.name==='string')
  :[];
}
