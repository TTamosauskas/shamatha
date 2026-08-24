-- Índice de apoio para a chave estrangeira da agenda de aulas.
create index if not exists live_classes_created_by_idx on public.live_classes(created_by);
