CREATE OR REPLACE FUNCTION pitacco_private.group_geo_compatible(slat double precision, slon double precision, alat double precision, alon double precision, blat double precision, blon double precision)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
select case when not (pitacco_private.group_geo_valid(slat,slon) and pitacco_private.group_geo_valid(alat,alon) and pitacco_private.group_geo_valid(blat,blon)) then false
-- Close destinations are compatible even if the bearing from the shop is undefined.
when pitacco_private.group_geo_km(alat,alon,blat,blon)<=0.05 then true
when pitacco_private.group_geo_km(slat,slon,alat,alon)<0.05 or pitacco_private.group_geo_km(slat,slon,blat,blon)<0.05 then false
else cos(atan2(sin(radians(alon-slon))*cos(radians(alat)),cos(radians(slat))*sin(radians(alat))-sin(radians(slat))*cos(radians(alat))*cos(radians(alon-slon)))-
atan2(sin(radians(blon-slon))*cos(radians(blat)),cos(radians(slat))*sin(radians(blat))-sin(radians(slat))*cos(radians(blat))*cos(radians(blon-slon))))>=cos(radians(45::double precision)) end
$function$;
