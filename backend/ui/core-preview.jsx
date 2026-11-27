import React from 'react';
import {createRoot} from 'react-dom/client';
import CoreMerchantHost from './CoreMerchantHost.jsx';
// This entry is generated only for the isolated integration build. No
// production hostname, legacy auth or native printer is activated.
const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
createRoot(document.getElementById('root')).render(local?<CoreMerchantHost enableOwnActions={true}/>:<p>Ensaio Core disponível apenas em ambiente local.</p>);
