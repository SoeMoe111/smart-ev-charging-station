const nav=document.getElementById('nav');document.getElementById('menuBtn').onclick=()=>nav.classList.toggle('open');document.querySelectorAll('nav a').forEach(a=>a.onclick=()=>nav.classList.remove('open'));

const bookings=JSON.parse(localStorage.getItem('evBookings')||'[]');
const bookingBox=document.getElementById('bookings');
function renderBookings(){
  if(!bookings.length){bookingBox.innerHTML='<h3>Live calendar</h3><p>No bookings saved on this device yet.</p>';return}
  bookingBox.innerHTML='<h3>Live calendar</h3>'+bookings.map((b,i)=>`<p><b>${b.date} ${b.time}</b> · ${b.slot} · ${b.duration} min · ${b.plate} <button onclick="removeBooking(${i})">Cancel</button></p>`).join('');
}
window.removeBooking=i=>{bookings.splice(i,1);localStorage.setItem('evBookings',JSON.stringify(bookings));renderBookings()}
document.getElementById('bookingForm').onsubmit=e=>{
 e.preventDefault();
 const data={driver:driver.value,plate:plate.value,uid:uid.value,date:date.value,slot:slot.value,time:time.value,duration:+duration.value};
 const start=new Date(`${data.date}T${data.time}`).getTime(), end=start+data.duration*60000;
 const conflict=bookings.some(b=>{if(b.slot!==data.slot||b.date!==data.date)return false;const s=new Date(`${b.date}T${b.time}`).getTime(),en=s+b.duration*60000;return start<en&&end>s});
 const msg=document.getElementById('bookingMsg');
 if(conflict){msg.textContent='Conflict: that slot overlaps an existing booking.';return}
 bookings.push(data);localStorage.setItem('evBookings',JSON.stringify(bookings));msg.textContent='Booking confirmed on this device.';renderBookings();e.target.reset();
};renderBookings();

const users=JSON.parse(localStorage.getItem('rfUsers')||'[]');
document.getElementById('rfidForm').onsubmit=e=>{
 e.preventDefault(); users.push({name:rfName.value,plate:rfPlate.value,email:rfEmail.value,uid:rfUid.value.trim().toUpperCase(),approved:true});
 localStorage.setItem('rfUsers',JSON.stringify(users)); alert('RFID user saved on this device.'); e.target.reset();
};
document.getElementById('scanBtn').onclick=()=>{
 const u=scanUid.value.trim().toUpperCase(); const ok=users.some(x=>x.uid===u);
 document.getElementById('scanResult').textContent=ok?'ACCESS GRANTED':'ACCESS DENIED';
};