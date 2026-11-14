-- Industrial Paint v24: ADMIN-only edit/delete for daily paint consumption.
-- Review this migration and run it in Supabase SQL Editor before using Modifier/Supprimer.
-- It does not update or delete old stock movements: corrections are appended as new IN/OUT ledger rows.

create or replace function public.admin_update_paint_daily_consumption(
  p_consumption_id uuid,
  p_consumption_date date,
  p_coating_system text,
  p_production_weight_kg numeric,
  p_layers jsonb,
  p_diluant_product_id uuid,
  p_diluant_kg numeric,
  p_notes text,
  p_chemist_kg numeric,
  p_rouleaux_kg numeric,
  p_pompes_kg numeric
) returns void
language plpgsql security definer set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_head public.paint_daily_consumptions%rowtype;
  v_allowed text[];
  v_layer jsonb;
  v_code text;
  v_pid uuid;
  v_qty numeric;
  v_old numeric;
  v_new numeric;
  v_delta numeric;
  v_stock numeric;
  v_product_id uuid;
begin
  if v_user is null or not public.is_active_user() or public.current_app_role() <> 'ADMIN' then
    raise exception 'Only an active ADMIN can edit daily paint consumption';
  end if;
  select * into v_head from public.paint_daily_consumptions where id=p_consumption_id for update;
  if not found then raise exception 'Daily consumption record not found'; end if;
  if p_coating_system not in ('PCM','PRINTING','VCM') then raise exception 'Invalid coating system'; end if;
  if p_production_weight_kg is null or p_production_weight_kg<=0 then raise exception 'Production weight must be greater than zero'; end if;
  if jsonb_typeof(p_layers)<>'array' or jsonb_array_length(p_layers)=0 then raise exception 'At least one paint layer is required'; end if;
  if round(coalesce(p_diluant_kg,0),3)<>round(coalesce(p_chemist_kg,0)+coalesce(p_rouleaux_kg,0)+coalesce(p_pompes_kg,0),3) then
    raise exception 'Diluant split must equal the total Diluant quantity';
  end if;
  if coalesce(p_diluant_kg,0)<0 then raise exception 'Invalid Diluant quantity'; end if;
  if p_diluant_kg>0 and p_diluant_product_id is null then raise exception 'Select the Diluant chemical product'; end if;
  v_allowed:=case p_coating_system when 'PCM' then array['BACK','PRIMER','FINISH'] when 'PRINTING' then array['BACK','PRIMER','FINISH','INK'] when 'VCM' then array['BACK','FINISH'] end;

  -- Validate all submitted layers before posting any stock correction.
  for v_layer in select value from jsonb_array_elements(p_layers) loop
    v_code:=upper(v_layer->>'layer_code');
    v_pid:=nullif(v_layer->>'chemical_product_id','')::uuid;
    v_qty:=round((v_layer->>'consumption_kg')::numeric,3);
    if v_code<>all(v_allowed) or v_pid is null or v_qty is null or v_qty<=0 then raise exception 'Invalid layer payload'; end if;
    if not exists(select 1 from public.chemical_products where id=v_pid and unit='kg' and active=true) then raise exception 'Layer chemical product not found or not measured in kg'; end if;
  end loop;
  if p_diluant_kg>0 and not exists(select 1 from public.chemical_products where id=p_diluant_product_id and unit='kg' and active=true) then raise exception 'Diluant product not found or not measured in kg'; end if;

  -- For every affected product, append only the net stock delta.
  for v_product_id in
    select product_id from (
      select chemical_product_id as product_id from public.paint_daily_consumption_layers where daily_consumption_id=p_consumption_id and chemical_product_id is not null
      union select v_head.diluant_product_id where v_head.diluant_kg>0 and v_head.diluant_product_id is not null
      union select nullif(x->>'chemical_product_id','')::uuid from jsonb_array_elements(p_layers) x
      union select p_diluant_product_id where coalesce(p_diluant_kg,0)>0
    ) q where product_id is not null
  loop
    select coalesce(sum(consumption_kg),0) into v_old from public.paint_daily_consumption_layers where daily_consumption_id=p_consumption_id and chemical_product_id=v_product_id;
    if v_head.diluant_product_id=v_product_id then v_old:=v_old+v_head.diluant_kg; end if;
    select coalesce(sum((x->>'consumption_kg')::numeric),0) into v_new from jsonb_array_elements(p_layers) x where nullif(x->>'chemical_product_id','')::uuid=v_product_id;
    if p_diluant_product_id=v_product_id then v_new:=v_new+coalesce(p_diluant_kg,0); end if;
    v_delta:=round(v_new-v_old,3);
    if v_delta>0 then
      perform 1 from public.chemical_products where id=v_product_id for update;
      select current_stock into v_stock from public.chemical_product_stock where product_id=v_product_id;
      if coalesce(v_stock,0)<v_delta then raise exception 'Insufficient stock for correction: available %, additional required %',coalesce(v_stock,0),v_delta; end if;
      insert into public.stock_movements(product_id,barrel_id,movement_type,quantity,movement_date,reference,notes,created_by)
      values(v_product_id,null,'OUT',v_delta,p_consumption_date,'PAINT-DAILY-EDIT-'||p_consumption_id,'Daily consumption edit — additional consumption',v_user);
    elsif v_delta<0 then
      insert into public.stock_movements(product_id,barrel_id,movement_type,quantity,movement_date,reference,notes,created_by)
      values(v_product_id,null,'IN',abs(v_delta),p_consumption_date,'PAINT-DAILY-EDIT-'||p_consumption_id,'Daily consumption edit — stock correction',v_user);
    end if;
  end loop;

  delete from public.paint_daily_consumption_layers where daily_consumption_id=p_consumption_id;
  for v_layer in select value from jsonb_array_elements(p_layers) loop
    v_code:=upper(v_layer->>'layer_code'); v_pid:=nullif(v_layer->>'chemical_product_id','')::uuid; v_qty:=round((v_layer->>'consumption_kg')::numeric,3);
    insert into public.paint_daily_consumption_layers(daily_consumption_id,layer_code,paint_product_id,chemical_product_id,consumption_kg,coefficient)
    values(p_consumption_id,v_code,null,v_pid,v_qty,round(v_qty/p_production_weight_kg,8));
  end loop;
  update public.paint_daily_consumptions set consumption_date=p_consumption_date,coating_system=p_coating_system,production_weight_kg=p_production_weight_kg,
    diluant_product_id=p_diluant_product_id,diluant_kg=coalesce(p_diluant_kg,0),notes=nullif(btrim(p_notes),''),
    diluant_chemist_kg=coalesce(p_chemist_kg,0),diluant_rouleaux_kg=coalesce(p_rouleaux_kg,0),diluant_pompes_kg=coalesce(p_pompes_kg,0)
  where id=p_consumption_id;
  insert into public.audit_log(actor_user_id,action,entity_table,entity_id,details)
  values(v_user,'UPDATE_PAINT_DAILY_CONSUMPTION','paint_daily_consumptions',p_consumption_id::text,
    jsonb_build_object('date',p_consumption_date,'system',p_coating_system,'production_weight_kg',p_production_weight_kg,'layers',p_layers,'diluant_kg',p_diluant_kg,'diluant_product_id',p_diluant_product_id));
end;
$$;

create or replace function public.admin_delete_paint_daily_consumption(p_consumption_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_head public.paint_daily_consumptions%rowtype;
  v_product_id uuid;
  v_qty numeric;
begin
  if v_user is null or not public.is_active_user() or public.current_app_role() <> 'ADMIN' then
    raise exception 'Only an active ADMIN can delete daily paint consumption';
  end if;
  select * into v_head from public.paint_daily_consumptions where id=p_consumption_id for update;
  if not found then raise exception 'Daily consumption record not found'; end if;
  for v_product_id in
    select product_id from (
      select chemical_product_id as product_id from public.paint_daily_consumption_layers where daily_consumption_id=p_consumption_id and chemical_product_id is not null
      union select v_head.diluant_product_id where v_head.diluant_kg>0 and v_head.diluant_product_id is not null
    ) q where product_id is not null
  loop
    select coalesce(sum(consumption_kg),0) into v_qty from public.paint_daily_consumption_layers where daily_consumption_id=p_consumption_id and chemical_product_id=v_product_id;
    if v_head.diluant_product_id=v_product_id then v_qty:=v_qty+v_head.diluant_kg; end if;
    if v_qty>0 then
      insert into public.stock_movements(product_id,barrel_id,movement_type,quantity,movement_date,reference,notes,created_by)
      values(v_product_id,null,'IN',round(v_qty,3),v_head.consumption_date,'PAINT-DAILY-DELETE-'||p_consumption_id,'Daily consumption deleted — stock restored',v_user);
    end if;
  end loop;
  delete from public.paint_daily_consumption_layers where daily_consumption_id=p_consumption_id;
  delete from public.paint_daily_consumptions where id=p_consumption_id;
  insert into public.audit_log(actor_user_id,action,entity_table,entity_id,details)
  values(v_user,'DELETE_PAINT_DAILY_CONSUMPTION','paint_daily_consumptions',p_consumption_id::text,
    jsonb_build_object('date',v_head.consumption_date,'system',v_head.coating_system,'production_weight_kg',v_head.production_weight_kg,'diluant_kg',v_head.diluant_kg));
end;
$$;

revoke all on function public.admin_update_paint_daily_consumption(uuid,date,text,numeric,jsonb,uuid,numeric,text,numeric,numeric,numeric) from public,anon;
grant execute on function public.admin_update_paint_daily_consumption(uuid,date,text,numeric,jsonb,uuid,numeric,text,numeric,numeric,numeric) to authenticated;
revoke all on function public.admin_delete_paint_daily_consumption(uuid) from public,anon;
grant execute on function public.admin_delete_paint_daily_consumption(uuid) to authenticated;
