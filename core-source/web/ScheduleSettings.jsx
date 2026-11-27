import React from 'react';
import StoreOpeningHours from './StoreOpeningHours.jsx';

// Public slots come from opening periods. Both entry points edit the same
// published configuration, including scheduling and manual pauses.
export default function ScheduleSettings({client,storeId}){
 return <StoreOpeningHours key={storeId} client={client} store={{id:storeId}}/>;
}
