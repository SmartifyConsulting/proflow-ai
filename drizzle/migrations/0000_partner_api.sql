CREATE TABLE public.api_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  partner_type text NOT NULL DEFAULT 'insurer',
  contact_email text,
  allowed_categories text[] NOT NULL DEFAULT ARRAY['basic','medical','documents','consultations'],
  status text NOT NULL DEFAULT 'active',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_partners TO authenticated;
GRANT ALL ON public.api_partners TO service_role;
ALTER TABLE public.api_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage partners" ON public.api_partners FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.api_partner_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.api_partner_keys TO authenticated;
GRANT ALL ON public.api_partner_keys TO service_role;
ALTER TABLE public.api_partner_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view keys" ON public.api_partner_keys FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins revoke keys" ON public.api_partner_keys FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.partner_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.api_partners(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,
  patient_user_id uuid,
  categories text[] NOT NULL,
  purpose text,
  reference text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.partner_access_requests(patient_user_id);
GRANT SELECT, UPDATE ON public.partner_access_requests TO authenticated;
GRANT ALL ON public.partner_access_requests TO service_role;
ALTER TABLE public.partner_access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Patient or admin view requests" ON public.partner_access_requests FOR SELECT TO authenticated
  USING (patient_user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Patient responds to requests" ON public.partner_access_requests FOR UPDATE TO authenticated
  USING (patient_user_id = auth.uid()) WITH CHECK (patient_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.partner_request_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF NEW.partner_id <> OLD.partner_id OR NEW.patient_id <> OLD.patient_id
     OR NEW.categories <> OLD.categories OR NEW.patient_user_id IS DISTINCT FROM OLD.patient_user_id THEN
    RAISE EXCEPTION 'Only status can be changed';
  END IF;
  IF NEW.status NOT IN ('approved','declined','revoked') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF NEW.status = 'approved' AND OLD.status <> 'pending' THEN RAISE EXCEPTION 'Only pending requests can be approved'; END IF;
  IF NEW.status = 'approved' THEN NEW.expires_at := now() + interval '12 months'; END IF;
  NEW.responded_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER partner_request_guard BEFORE UPDATE ON public.partner_access_requests
  FOR EACH ROW EXECUTE FUNCTION public.partner_request_guard();

CREATE TABLE public.partner_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid REFERENCES public.api_partners(id) ON DELETE SET NULL,
  patient_id uuid,
  patient_user_id uuid,
  endpoint text NOT NULL,
  category text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.partner_access_log(patient_user_id);
CREATE INDEX ON public.partner_access_log(partner_id, created_at);
GRANT SELECT ON public.partner_access_log TO authenticated;
GRANT ALL ON public.partner_access_log TO service_role;
ALTER TABLE public.partner_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Patient or admin view log" ON public.partner_access_log FOR SELECT TO authenticated
  USING (patient_user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));