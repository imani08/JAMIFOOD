'use client';

import { useState } from 'react';

import { api } from '../../lib/api';
import {
  Feedback,
  Heading,
  Loading,
  useAction,
  useData,
} from '../../components/common';

type Role = {
  id: string;
  code: string;
  label: string;
  permissions: string[];
};

type User = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  roles: {
    role: {
      id: string;
      code: string;
      label: string;
      permissions: {
        permission: {
          code: string;
        };
      }[];
    };
  }[];
};

function UserEditor({
  user,
  roles,
}: {
  user: User;
  roles: Role[];
}) {
  const action = useAction();

  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [email, setEmail] = useState(user.email ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');

  const [roleCodes, setRoleCodes] = useState<string[]>(
    user.roles.map((item) => item.role.code),
  );

  async function save() {
    await action.run(
      () =>
        api(`/users/${user.id}`, {
          firstName,
          lastName,
          email: email || null,
          phone: phone || null,
          roleCodes,
        }),
      'Utilisateur modifié.',
    );
  }

  async function changeStatus() {
    const next =
      user.status === 'ACTIVE'
        ? 'DISABLED'
        : 'ACTIVE';

    if (
      !window.confirm(
        next === 'DISABLED'
          ? 'Désactiver ce compte ? Ses sessions actives seront fermées.'
          : 'Réactiver ce compte ?',
      )
    ) {
      return;
    }

    await action.run(
      () =>
        api(`/users/${user.id}/status`, {
          status: next,
        }),
      next === 'ACTIVE'
        ? 'Compte réactivé.'
        : 'Compte désactivé.',
    );
  }

  async function resetPassword() {
    const password = window.prompt(
      'Nouveau mot de passe temporaire — minimum 12 caractères',
    );

    if (!password) {
      return;
    }

    if (password.length < 12) {
      window.alert(
        'Le mot de passe doit contenir au moins 12 caractères.',
      );
      return;
    }

    await action.run(
      () =>
        api(`/users/${user.id}/reset-password`, {
          newPassword: password,
        }),
      'Mot de passe réinitialisé. Les anciennes sessions ont été fermées.',
    );
  }

  return (
    <details className="card section">
      <summary>
        <strong>
          {user.firstName} {user.lastName}
        </strong>{' '}
        · {user.username}{' '}
        <span className="badge">
          {user.status}
        </span>
      </summary>

      <Feedback
        error={action.error}
        notice={action.notice}
      />

      <div className="form-grid section">
        <label>
          Prénom
          <input
            value={firstName}
            onChange={(event) =>
              setFirstName(event.target.value)
            }
          />
        </label>

        <label>
          Nom
          <input
            value={lastName}
            onChange={(event) =>
              setLastName(event.target.value)
            }
          />
        </label>

        <label>
          Courriel
          <input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
          />
        </label>

        <label>
          Téléphone
          <input
            value={phone}
            onChange={(event) =>
              setPhone(event.target.value)
            }
          />
        </label>
      </div>

      <label>
        Rôles
        <select
          multiple
          value={roleCodes}
          onChange={(event) =>
            setRoleCodes(
              Array.from(
                event.currentTarget.selectedOptions,
                (option) => option.value,
              ),
            )
          }
          style={{
            minHeight: 180,
          }}
        >
          {roles.map((role) => (
            <option
              key={role.code}
              value={role.code}
            >
              {role.label} — {role.code}
            </option>
          ))}
        </select>
      </label>

      <p className="muted small">
        Maintenez Ctrl pour sélectionner plusieurs rôles.
      </p>

      <div className="actions">
        <button
          className="primary"
          disabled={
            action.busy ||
            roleCodes.length === 0
          }
          onClick={save}
        >
          Enregistrer
        </button>

        <button
          className="secondary"
          disabled={action.busy}
          onClick={changeStatus}
        >
          {user.status === 'ACTIVE'
            ? 'Désactiver'
            : 'Réactiver'}
        </button>

        <button
          className="secondary"
          disabled={action.busy}
          onClick={resetPassword}
        >
          Réinitialiser le mot de passe
        </button>
      </div>
    </details>
  );
}

export default function Users() {
  const users = useData<User[]>(
    '/users?limit=100',
  );

  const roles = useData<Role[]>(
    '/users/roles',
  );

  const action = useAction();

  const [roleCodes, setRoleCodes] =
    useState<string[]>([]);

  async function createUser(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form = event.currentTarget;

    const data = new FormData(form);

    const result = await action.run(
      () =>
        api('/users', {
          username: String(
            data.get('username') ?? '',
          ),
          firstName: String(
            data.get('firstName') ?? '',
          ),
          lastName: String(
            data.get('lastName') ?? '',
          ),
          email:
            String(data.get('email') ?? '') ||
            undefined,
          phone:
            String(data.get('phone') ?? '') ||
            undefined,
          password: String(
            data.get('password') ?? '',
          ),
          roleCodes,
        }),
      'Utilisateur créé.',
    );

    if (result) {
      form.reset();
      setRoleCodes([]);
    }
  }

  return (
    <>
      <Heading
        title="Utilisateurs & habilitations"
        subtitle="Comptes individuels, rôles multiples et séparation des responsabilités."
      />

      <Feedback
        error={action.error}
        notice={action.notice}
      />

      <div className="two-columns">
        <form
          className="card"
          onSubmit={createUser}
        >
          <h2>Créer un utilisateur</h2>

          <div className="form-grid">
            <label>
              Prénom
              <input
                name="firstName"
                required
              />
            </label>

            <label>
              Nom
              <input
                name="lastName"
                required
              />
            </label>

            <label>
              Identifiant
              <input
                name="username"
                required
                minLength={3}
                autoComplete="off"
              />
            </label>

            <label>
              Mot de passe temporaire
              <input
                name="password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
            </label>

            <label>
              Courriel
              <input
                name="email"
                type="email"
              />
            </label>

            <label>
              Téléphone
              <input name="phone" />
            </label>
          </div>

          <label>
            Rôles
            <select
              multiple
              required
              value={roleCodes}
              onChange={(event) =>
                setRoleCodes(
                  Array.from(
                    event.currentTarget
                      .selectedOptions,
                    (option) => option.value,
                  ),
                )
              }
              style={{
                minHeight: 190,
              }}
            >
              {roles.data?.map((role) => (
                <option
                  key={role.code}
                  value={role.code}
                >
                  {role.label} — {role.code}
                </option>
              ))}
            </select>
          </label>

          <p className="muted small">
            Maintenez Ctrl pour sélectionner plusieurs rôles.
          </p>

          <button
            className="primary"
            disabled={
              action.busy ||
              roleCodes.length === 0
            }
          >
            Créer le compte
          </button>
        </form>

        <section className="card">
          <h2>Matrice des rôles</h2>

          <Loading
            loading={roles.isLoading}
            error={roles.error}
          />

          {roles.data?.map((role) => (
            <details
              key={role.code}
              className="item"
            >
              <summary>
                <strong>{role.label}</strong>
                <br />
                <small className="muted">
                  {role.permissions.length}{' '}
                  permission(s)
                </small>
              </summary>

              <p className="muted small">
                {role.permissions.join(', ')}
              </p>
            </details>
          ))}
        </section>
      </div>

      <section className="section">
        <h2>Comptes du personnel</h2>

        <Loading
          loading={users.isLoading}
          error={users.error}
        />

        {users.data?.map((user) => (
          <UserEditor
            key={user.id}
            user={user}
            roles={roles.data ?? []}
          />
        ))}

        {!users.data?.length &&
          !users.isLoading && (
            <p className="empty">
              Aucun utilisateur.
            </p>
          )}
      </section>
    </>
  );
}