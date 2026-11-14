-- Read-only verification for Industrial Paint v19.
-- Run only after UPDATE_2026_11_14_BACK_CHEMICAL_FIX.sql succeeds.

-- 1) Confirm the new chemical-barrel link exists.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public'
  and table_name='layer_consumptions'
  and column_name='chemical_barrel_id';

-- 2) Confirm the EP-3189 barrel balance from its movement ledger.
select barrel_id, product_code, product_name, barrel_number,
       net_weight_kg, remaining_quantity_kg, total_out_kg, material_status
from public.chemical_barrel_stock
where product_code='EP-3189'
order by barrel_number;

-- 3) Confirm the required RPCs are installed.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'save_production_with_consumption',
    'admin_delete_production_record',
    'admin_update_production_layers',
    'admin_change_chemical_consumption_movement',
    'save_paint_daily_consumption_with_split',
    'get_chemical_annual_consumption'
  )
order by p.proname;

-- 4) Check that production-linked chemical OUT movements are unique.
select reference, count(*) as duplicate_count
from public.stock_movements
where movement_type='OUT'
  and barrel_id is not null
  and reference like 'PROD:%'
group by reference
having count(*) > 1;

-- 5) Confirm the history constraint accepts RESTAURATION.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid='public.chemical_barrel_inventory_history'::regclass
  and conname='chemical_barrel_inventory_history_event_type_check';
