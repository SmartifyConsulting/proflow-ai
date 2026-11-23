CREATE OR REPLACE FUNCTION public.is_ops_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('hospital_staff'::user_role,'nurse'::user_role,'doctor'::user_role,'admin'::user_role))
$$;

DO $do$
DECLARE r record; pred text; verb text; cmd text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('app_modules','Anyone authenticated can read modules'),
    ('streak_config','Authenticated users can view streak config'),
    ('gamification_config','Authenticated users can view gamification config'),
    ('biolog_ageing_config','ageing_config_read'),
    ('ask_maeve_processes','Signed-in users can read maeve processes'),
    ('vula_adherence_configs','Authenticated users can view adherence configs'),
    ('holarchelp_voice_clip_settings','Anyone authenticated can read guardian voice settings'),
    ('treatment_guidelines','public_can_view_guidelines'),
    ('incident_report_templates','public_can_view_report_templates'),
    ('lab_order_templates','public_can_view_lab_templates')) v(t,p)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.p, r.t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)', r.p, r.t);
  END LOOP;

  FOR r IN SELECT * FROM (VALUES
    ('demand_forecasts','SELECT,INSERT',true),
    ('department_budgets','SELECT,INSERT,UPDATE',true),
    ('patient_invoices','SELECT,INSERT,UPDATE',true),
    ('procedure_kits','SELECT,INSERT,UPDATE',true),
    ('purchase_orders','SELECT,INSERT,UPDATE',true),
    ('stock_count_reconciliation','SELECT,INSERT',true),
    ('stock_items','SELECT,INSERT,UPDATE',true),
    ('stock_levels','SELECT,INSERT,UPDATE',true),
    ('stock_requisitions','SELECT,INSERT,UPDATE',true),
    ('budget_actuals','SELECT,INSERT',false),
    ('goods_received','SELECT,INSERT',false),
    ('patient_invoice_lines','SELECT,INSERT',false),
    ('procedure_kit_items','SELECT,INSERT,DELETE',false),
    ('procedure_stock_usage','SELECT,INSERT,UPDATE',false),
    ('purchase_order_lines','SELECT,INSERT,UPDATE',false),
    ('suppliers','SELECT,INSERT,UPDATE',false),
    ('vendor_invoices','SELECT,INSERT,UPDATE',false)) v(t,cmds,hosp)
  LOOP
    pred := CASE WHEN r.hosp
      THEN '(public.is_hospital_staff(hospital_id, auth.uid()) OR public.has_role(auth.uid(), ''admin''::user_role))'
      ELSE 'public.is_ops_staff(auth.uid())' END;
    FOREACH cmd IN ARRAY string_to_array(r.cmds, ',') LOOP
      verb := CASE cmd WHEN 'SELECT' THEN 'view' ELSE lower(cmd) END;
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_can_'||verb||'_'||r.t, r.t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated %s',
        'authenticated_can_'||verb||'_'||r.t, r.t, cmd,
        CASE cmd WHEN 'INSERT' THEN 'WITH CHECK ('||pred||')'
                 WHEN 'UPDATE' THEN 'USING ('||pred||') WITH CHECK ('||pred||')'
                 ELSE 'USING ('||pred||')' END);
    END LOOP;
  END LOOP;
END $do$;