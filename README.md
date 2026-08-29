# Temu Ticket Automation — Exact icon and movable card v2.4.0

Yeh Chrome extension Temu Seller Center ke Information Ticket list page par professional logo ke saath top-right automation card show karti hai. Card ke **Run next 10 tickets** button se next 10 ticket detail pages controlled background tabs mein open hote hain. Har tab Reply, **Able to ship**, latest enabled date, `23:59:59`, rotating remarks, automatic Confirm submit, aur successful tab close workflow chalata hai.

## Draggable and minimizable card

Card default kisi corner mein hota hai. Header ya logo par mouse se click karke drag karen; card screen ke andar move ho jayega aur uski position save ho jayegi, is liye page refresh ke baad bhi woh usi jagah rahega. Card ke top-right **−** button se card minimize ho kar aapki di hui exact black-and-white circular character image wala floating icon ban jata hai. Minimized icon ko drag kar sakte hain; drag ke baghair single click se full card restore hota hai.

## Exact icon asset

Extension toolbar, card, aur minimized floating button mein user-provided black-and-white character image ka exact resized version use hota hai. Koi alternate generated logo package mein use nahi kiya gaya.

## Remark message settings

Settings page ab professional message manager ke form mein hai. Aap messages add, edit, delete, aur ↑/↓ buttons se reorder kar sakte hain. Har message maximum 1500 characters ka ho sakta hai. Existing 15 variants default library ke taur par loaded hain, aur agar aap new messages add karte hain to extension un sab ko current order mein cycle karti hai. Settings kholne ke liye extension popup mein **Edit remark messages** click karen, ya `chrome://extensions` par extension ke **Details → Extension options** open karen.

## Automation workflow

Har batch ke ticket tabs mein Reply open hota hai, Verification result mein **Able to ship** select hota hai, date picker ke andar sab se latest enabled date select karke uska apna Confirm press hota hai, time `23:59:59` verify hota hai, selected remark fill hota hai, aur final Reply Confirm submit hota hai. Submission successful hone ke baad tab close hota hai. Unexpected UI ya validation error par tab open rehta hai.

## Performance

List page par continuous DOM observer, background polling, ya repeating scan nahi hai. Ticket rows sirf card button click ke waqt scan hoti hain. Batch tabs 2.5 seconds ke gap se open hote hain.

## Install / update

1. ZIP ko download karke unzip karen.
2. Chrome mein `chrome://extensions` kholen aur **Developer mode** on karen.
3. Purani Temu extension remove karen, phir new extracted `temu-ticket-tabs` folder ko **Load unpacked** se load karen.
4. Temu ke purane open detail tabs close karen.
5. Temu ticket-list page ko close karke dobara open karen.
6. Pehle ek 10-ticket batch par test karen.

Yeh extension sirf selected ticket Reply workflow ko automate karti hai. Automatic submit active hai, is liye run karne se pehle sahi Pending list/filter aur saved messages verify karen.
