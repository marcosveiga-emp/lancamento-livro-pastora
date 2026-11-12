import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  BookOpen,
  Utensils,
  Clock,
  Phone,
  Check,
  Search,
  Download,
  RefreshCw,
  Settings,
  LogOut,
  Award,
  UserPlus,
  Send,
  X
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell
} from 'recharts';

// Cole aqui a URL do Google Apps Script implantado na planilha "O Porque De Servir"
// Ou configure diretamente pelo botão "Conectar Planilha" no topo do painel
const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwu6ZPyFIQwVQ2Ui0V-MUtPCqJVScEi5BWOOi7muODF6FtdV1Vtew11EAH51blv_Hyq/exec';

const INITIAL_SHEET_DATA = [];

function parseBrDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const str = String(dateStr).trim();
  // Format DD/MM/YYYY or DD/MM/YYYY HH:mm:ss
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const [, day, month, year, hour = '00', min = '00', sec = '00'] = match;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(min), Number(sec));
  }
  const iso = new Date(str);
  return isNaN(iso.getTime()) ? null : iso;
}

function formatDateShort(dateVal) {
  if (!dateVal) return '-';
  const parsed = parseBrDate(dateVal);
  if (parsed) {
    return parsed.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return String(dateVal);
}

function formatDateTime(dateVal) {
  if (!dateVal) return '-';
  const parsed = parseBrDate(dateVal);
  if (parsed) {
    return parsed.toLocaleString('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  return String(dateVal);
}

function formatInviteDate(dateVal) {
  if (!dateVal) return '-';
  const str = String(dateVal).trim();
  if (str.includes(':')) {
    return formatDateTime(dateVal);
  }
  return formatDateShort(dateVal);
}

function normalizeRow(raw, idx) {
  const getVal = (...keys) => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null) return raw[k];
    }
    return '';
  };

  const toBool = (val) => {
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    return s === 'true' || s === 'sim' || s === '1' || s === 'yes' || s === 'pago';
  };

  const rawJantar = getVal('jantar_pago', 'Jantar pago');
  const rawVip = getVal('vip', 'VIP', 'convidado_nao_paga', 'Convidado (não paga)', 'convidado_(não_paga)', 'convidado_(nao_paga)');
  const isVipVal = String(rawJantar).trim().toUpperCase() === 'VIP' || toBool(rawVip);
  const isPagoVal = !isVipVal && toBool(rawJantar);

  const livroStr = String(getVal('livro_comprado', 'Livro comprado', 'livro_comprado_')).trim();
  const rawTotalLivros = getVal('total_livros', 'Total de livros', 'total_de_livros');
  const parsedTotal = Number(rawTotalLivros) || (livroStr ? 1 : 0);

  return {
    id: getVal('id', 'ID') || idx + 1,
    nome: getVal('nome', 'Nome', 'full_name') || 'Sem nome',
    telemovel: String(getVal('telemovel', 'Telemóvel', 'telemóvel', 'whatsapp_number', 'telefone') || ''),
    data_compra: getVal('data_compra', 'Data/hora da compra', 'data_hora_da_compra', 'data/hora_da_compra'),
    convidado_em: getVal('convidado_em', 'Convidado em'),
    prazo: getVal('prazo', 'Prazo'),
    jantar_pago: isPagoVal,
    vip: isVipVal,
    livro_comprado: livroStr,
    total_livros: parsedTotal
  };
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const loginStr = localStorage.getItem('pastora_livro_login');
    if (loginStr) {
      try {
        const loginData = JSON.parse(loginStr);
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - loginData.timestamp < sevenDays) {
          return true;
        }
      } catch {
        localStorage.removeItem('pastora_livro_login');
      }
    }
    return false;
  });

  const [loggedUser, setLoggedUser] = useState(() => {
    const loginStr = localStorage.getItem('pastora_livro_login');
    if (loginStr) {
      try {
        const loginData = JSON.parse(loginStr);
        return loginData.user || 'Equipa';
      } catch {
        return 'Equipa';
      }
    }
    return '';
  });

  const [authKey, setAuthKey] = useState(() => {
    const loginStr = localStorage.getItem('pastora_livro_login');
    if (loginStr) {
      try {
        return JSON.parse(loginStr).key || '';
      } catch {
        return '';
      }
    }
    return '';
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [scriptUrl, setScriptUrl] = useState(() => {
    return localStorage.getItem('pastora_script_url') || DEFAULT_SCRIPT_URL;
  });
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [tempScriptUrl, setTempScriptUrl] = useState(scriptUrl);

  const [data, setData] = useState(() => {
    const saved = localStorage.getItem('pastora_cached_data');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return INITIAL_SHEET_DATA;
      }
    }
    return INITIAL_SHEET_DATA;
  });

  const [loading, setLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState(scriptUrl ? 'Sincronizado' : 'Dados da Planilha (Local)');
  const [timeFilter, setTimeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const fetchSheetData = async (urlToUse = scriptUrl, keyToUse = authKey) => {
    if (!urlToUse) return;
    setLoading(true);
    try {
      const separator = urlToUse.includes('?') ? '&' : '?';
      const response = await fetch(`${urlToUse}${separator}crm=list&key=${encodeURIComponent(keyToUse)}`);
      const result = await response.json();
      const rows = Array.isArray(result) ? result : (result.data || []);
      if (rows.length > 0) {
        const normalized = rows.map((r, i) => normalizeRow(r, i));
        setData(normalized);
        localStorage.setItem('pastora_cached_data', JSON.stringify(normalized));
        setSyncStatus('Sincronizado com Google Sheets');
      }
    } catch (err) {
      console.error('Erro ao buscar planilha:', err);
      setSyncStatus('Usando cópia local (verifique a URL do Script)');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (scriptUrl && isAuthenticated) {
      fetchSheetData(scriptUrl, authKey);
      const intervalId = setInterval(() => fetchSheetData(scriptUrl, authKey), 30000);
      return () => clearInterval(intervalId);
    }
  }, [scriptUrl, isAuthenticated, authKey]);

  const filteredData = useMemo(() => {
    const now = new Date();
    return data.filter((item) => {
      // Busca por nome ou telemóvel
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchNome = item.nome.toLowerCase().includes(q);
        const matchTel = item.telemovel.toLowerCase().includes(q);
        const matchLivro = (item.livro_comprado || '').toLowerCase().includes(q);
        if (!matchNome && !matchTel && !matchLivro) return false;
      }

      // Filtro de status
      const itemVip = Boolean(item.vip || item.convidado_nao_paga);
      if (statusFilter === 'jantar_pago' && !item.jantar_pago) return false;
      if (statusFilter === 'pendente' && (item.jantar_pago || itemVip)) return false;
      if (statusFilter === 'com_livro' && item.total_livros <= 0 && !item.livro_comprado) return false;
      if (statusFilter === 'vip' && !itemVip) return false;
      if (statusFilter === 'convite_enviado' && !item.convidado_em) return false;
      if (statusFilter === 'falta_convite' && Boolean(item.convidado_em)) return false;

      // Filtro de data (baseado em Convidado em ou Data da compra)
      if (timeFilter !== 'all') {
        const refDate = parseBrDate(item.convidado_em) || parseBrDate(item.data_compra);
        if (!refDate) return false;

        if (timeFilter === 'hoje') {
          return refDate.toDateString() === now.toDateString();
        }
        if (timeFilter === 'ontem') {
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          return refDate.toDateString() === yesterday.toDateString();
        }
        if (timeFilter === '7d') {
          const diffDays = Math.ceil(Math.abs(now - refDate) / (1000 * 60 * 60 * 24));
          return diffDays <= 7;
        }
        if (timeFilter === 'mes') {
          return refDate.getMonth() === now.getMonth() && refDate.getFullYear() === now.getFullYear();
        }
        if (timeFilter === 'custom') {
          const itemDay = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
          if (customStartDate) {
            const [y, m, d] = customStartDate.split('-');
            if (itemDay < new Date(y, m - 1, d)) return false;
          }
          if (customEndDate) {
            const [y, m, d] = customEndDate.split('-');
            if (itemDay > new Date(y, m - 1, d)) return false;
          }
        }
      }

      return true;
    });
  }, [data, searchTerm, statusFilter, timeFilter, customStartDate, customEndDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, timeFilter, customStartDate, customEndDate, itemsPerPage]);

  const sha256Hex = async (str) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const userClean = username
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');

    const teamUsers = {
      rebeca: 'Rebeca Oliveira',
      'rebeca oliveira': 'Rebeca Oliveira',
      malu: 'Malu Minich',
      'malu minich': 'Malu Minich',
      marcos: 'Marcos Veiga',
      'marcos veiga': 'Marcos Veiga',
      daniel: 'Daniel Adegas',
      'daniel adegas': 'Daniel Adegas',
      debora: 'Débora Chaves',
      'debora chaves': 'Débora Chaves',
      pastora: 'Pastora'
    };

    const teamHash = await sha256Hex('pastora-salt-2026:' + password);
    const userHash = await sha256Hex('pastora-salt-2026:' + userClean + ':' + password);

    let matchedDisplayName = null;
    if (teamUsers[userClean] && teamHash === '7176fb1a025e9fcac698af3a4ad436becb7f9a27644058261b079b5a007fdb28') {
      matchedDisplayName = teamUsers[userClean];
    } else if (userHash === '4151a3c906ddddde55803780f8d9c67e36a1d68d15ffb8989a9d062a2490ce8d') {
      matchedDisplayName = 'Admin';
    } else if (userHash === '195e761a73e4a930b5ebe9c8fb4dc03f0435b2b0d781b26d30e9b0234839c3b1') {
      matchedDisplayName = 'SlotFleet';
    }

    if (matchedDisplayName) {
      setIsAuthenticated(true);
      setLoggedUser(matchedDisplayName);
      setAuthKey(teamHash);
      setLoginError('');
      localStorage.setItem(
        'pastora_livro_login',
        JSON.stringify({ timestamp: Date.now(), user: matchedDisplayName, key: teamHash })
      );
    } else {
      setLoginError('Utilizador ou palavra-passe incorretos.');
    }
  };

  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState('single'); // 'single' | 'batch'
  const [newNome, setNewNome] = useState('');
  const [newTelemovel, setNewTelemovel] = useState('');
  const [batchText, setBatchText] = useState('');

  const getNowDateTimeAndDeadline = () => {
    const now = new Date();
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + 6);
    const pad = (n) => String(n).padStart(2, '0');
    const dateTimeStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const deadlineStr = `${pad(deadline.getDate())}/${pad(deadline.getMonth() + 1)}/${deadline.getFullYear()}`;
    return { convidado_em: dateTimeStr, prazo: deadlineStr };
  };

  const handleMarkInviteSent = async (row) => {
    const { convidado_em, prazo } = getNowDateTimeAndDeadline();
    const finalPrazo = row.prazo || prazo;

    const updated = data.map((item) => {
      if (item.id === row.id && item.nome === row.nome) {
        return { ...item, convidado_em, prazo: finalPrazo };
      }
      return item;
    });
    setData(updated);
    localStorage.setItem('pastora_cached_data', JSON.stringify(updated));

    if (scriptUrl) {
      const separator = scriptUrl.includes('?') ? '&' : '?';
      try {
        await fetch(
          `${scriptUrl}${separator}crm=invite_sent&key=${encodeURIComponent(authKey)}&id=${encodeURIComponent(row.id)}&nome=${encodeURIComponent(row.nome)}&convidado_em=${encodeURIComponent(convidado_em)}&prazo=${encodeURIComponent(finalPrazo)}`,
          { method: 'GET', mode: 'no-cors' }
        );
      } catch (err) {
        console.error('Erro ao marcar convite enviado na planilha:', err);
      }
    }
  };

  const handleAddGuests = async (e) => {
    e.preventDefault();
    const maxId = data.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    const entriesToAdd = [];

    if (addMode === 'single') {
      if (!newNome.trim()) return;
      entriesToAdd.push({
        id: maxId + 1,
        nome: newNome.trim(),
        telemovel: newTelemovel.trim(),
        data_compra: '',
        convidado_em: '',
        prazo: '',
        jantar_pago: false,
        vip: false,
        livro_comprado: '',
        total_livros: 0
      });
    } else {
      const lines = batchText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      lines.forEach((line, idx) => {
        // Suporta formato "Nome - Telemovel", "Nome;Telemovel", "Nome, Telemovel" ou Tab (copiado do Excel)
        const parts = line.split(/[\t;,-]+/).map((p) => p.trim()).filter(Boolean);
        const nome = parts[0] || '';
        const telemovel = parts.slice(1).join(' ') || '';
        if (nome) {
          entriesToAdd.push({
            id: maxId + idx + 1,
            nome,
            telemovel,
            data_compra: '',
            convidado_em: '',
            prazo: '',
            jantar_pago: false,
            vip: false,
            livro_comprado: '',
            total_livros: 0
          });
        }
      });
    }

    if (entriesToAdd.length === 0) return;

    const updated = [...data, ...entriesToAdd];
    setData(updated);
    localStorage.setItem('pastora_cached_data', JSON.stringify(updated));

    if (scriptUrl) {
      const separator = scriptUrl.includes('?') ? '&' : '?';
      for (const guest of entriesToAdd) {
        try {
          await fetch(
            `${scriptUrl}${separator}crm=add&key=${encodeURIComponent(authKey)}&nome=${encodeURIComponent(guest.nome)}&telemovel=${encodeURIComponent(guest.telemovel)}`,
            { method: 'GET', mode: 'no-cors' }
          );
        } catch (err) {
          console.error('Erro ao adicionar convidado na planilha:', err);
        }
      }
      setTimeout(() => fetchSheetData(scriptUrl, authKey), 1500);
    }

    setNewNome('');
    setNewTelemovel('');
    setBatchText('');
    setShowAddModal(false);
  };

  const formatWhatsAppLink = (phone, nome) => {
    if (!phone) return '#';
    const clean = phone.toString().replace(/\D/g, '');
    // Se tiver 9 dígitos (padrão Portugal: 9xxxxxxxx), adiciona +351
    let finalPhone = clean;
    if (clean.length === 9) {
      finalPhone = `351${clean}`;
    } else if (clean.length === 10 || clean.length === 11) {
      finalPhone = `55${clean}`;
    }
    const msg = encodeURIComponent(`Olá ${nome || ''}, tudo bem? Passando para falar sobre o lançamento do livro "O Porquê de Servir"!`);
    return `https://wa.me/${finalPhone}?text=${msg}`;
  };

  const exportToCSV = () => {
    const headers = [
      'ID',
      'Nome',
      'Telemóvel',
      'Data/hora da compra',
      'Convidado em',
      'Prazo',
      'Jantar pago',
      'Livro comprado',
      'Total de livros'
    ];
    const csvRows = [
      headers.join(';'),
      ...filteredData.map((r) => {
        const isRowVip = Boolean(r.vip || r.convidado_nao_paga);
        const statusJantar = r.jantar_pago ? 'SIM' : isRowVip ? 'VIP' : 'NÃO';
        return [
          r.id,
          `"${r.nome}"`,
          `"${r.telemovel}"`,
          `"${formatDateTime(r.data_compra)}"`,
          `"${formatDateShort(r.convidado_em)}"`,
          `"${formatDateShort(r.prazo)}"`,
          statusJantar,
          `"${r.livro_comprado || ''}"`,
          r.total_livros || 0
        ].join(';');
      })
    ];
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `O_Porque_De_Servir_Convidados.csv`;
    a.click();
  };

  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="logo-badge" style={{ margin: '0 auto 1.2rem', width: '68px', height: '68px' }}>
            <BookOpen size={34} />
          </div>
          <h2>
            <span className="brand-white">O PORQUÊ DE </span>
            <span className="brand-gold">SERVIR</span>
          </h2>
          <p style={{ letterSpacing: '1.5px', textTransform: 'uppercase', fontSize: '0.78rem' }}>
            Lançamento do Livro & Gestão de Jantar
          </p>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Utilizador</label>
              <input
                type="text"
                className="login-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ex: rebeca ou Rebeca Oliveira"
              />
            </div>
            <div className="form-group">
              <label>Palavra-passe</label>
              <input
                type="password"
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite a sua senha"
              />
            </div>
            {loginError && <div className="login-error">{loginError}</div>}
            <button type="submit" className="login-btn">
              Entrar no Painel
            </button>
          </form>
        </div>
      </div>
    );
  }

  // KPIs
  const totalConvidados = filteredData.length;
  const convitesEnviados = filteredData.filter((d) => Boolean(d.convidado_em)).length;
  const faltamEnviarConvite = totalConvidados - convitesEnviados;
  const jantaresPagos = filteredData.filter((d) => d.jantar_pago).length;
  const convidadosVip = filteredData.filter((d) => Boolean(d.vip || d.convidado_nao_paga)).length;
  const pendentesJantar = filteredData.filter((d) => !d.jantar_pago && !d.vip && !d.convidado_nao_paga).length;
  const totalLivrosVendidos = filteredData.reduce((acc, d) => acc + (Number(d.total_livros) || 0), 0);
  const taxaConfirmacao = totalConvidados > 0
    ? Math.round(((jantaresPagos + convidadosVip) / totalConvidados) * 100)
    : 0;

  // Gráfico 1: Evolução por data de convite vs compras
  const timelineMap = {};
  filteredData.forEach((item) => {
    const convDate = parseBrDate(item.convidado_em);
    if (convDate) {
      const key = convDate.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
      if (!timelineMap[key]) timelineMap[key] = { date: key, convidados: 0, pagos: 0, livros: 0 };
      timelineMap[key].convidados += 1;
      if (item.jantar_pago) timelineMap[key].pagos += 1;
      timelineMap[key].livros += Number(item.total_livros) || 0;
    }
  });

  const timelineData = Object.values(timelineMap).sort((a, b) => {
    const [d1, m1] = a.date.split('/');
    const [d2, m2] = b.date.split('/');
    return new Date(2026, m1 - 1, d1) - new Date(2026, m2 - 1, d2);
  });

  // Gráfico 2: Status do Jantar
  const jantarPieData = [
    { name: 'Jantar Pago', value: jantaresPagos, color: '#22c55e' },
    { name: 'Pendente', value: pendentesJantar, color: '#d4af37' },
    { name: 'VIP', value: convidadosVip, color: '#556b2f' }
  ].filter((d) => d.value > 0);

  // Gráfico 3: Funil do Lançamento (Lista vs Convites Enviados pelas meninas vs Pagos vs Livros)
  const funilBarData = [
    { etapa: 'Na Lista', total: totalConvidados },
    { etapa: 'Convites Enviados', total: convitesEnviados },
    { etapa: 'Jantar Pago', total: jantaresPagos },
    { etapa: 'Livros Vendidos', total: totalLivrosVendidos }
  ];

  const totalPages = Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentRows = filteredData.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="dashboard-container">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.1rem' }}>
          <div className="logo-badge">
            <BookOpen size={30} />
          </div>
          <div>
            <h1>
              <span className="brand-white">O PORQUÊ DE </span>
              <span className="brand-gold">SERVIR</span>
            </h1>
            <p style={{ letterSpacing: '1px', textTransform: 'uppercase', fontSize: '0.8rem' }}>
              Painel de Lançamento do Livro & Controle de Convidados
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="filter-group">
            <button className={`filter-btn ${timeFilter === 'hoje' ? 'active' : ''}`} onClick={() => setTimeFilter('hoje')}>Hoje</button>
            <button className={`filter-btn ${timeFilter === 'ontem' ? 'active' : ''}`} onClick={() => setTimeFilter('ontem')}>Ontem</button>
            <button className={`filter-btn ${timeFilter === '7d' ? 'active' : ''}`} onClick={() => setTimeFilter('7d')}>7 Dias</button>
            <button className={`filter-btn ${timeFilter === 'mes' ? 'active' : ''}`} onClick={() => setTimeFilter('mes')}>Mês</button>
            <button className={`filter-btn ${timeFilter === 'all' ? 'active' : ''}`} onClick={() => setTimeFilter('all')}>Tudo</button>
            <button className={`filter-btn ${timeFilter === 'custom' ? 'active' : ''}`} onClick={() => setTimeFilter('custom')}>Personalizado</button>
          </div>

          {timeFilter === 'custom' && (
            <div className="custom-date-group">
              <input type="date" className="date-input" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>até</span>
              <input type="date" className="date-input" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} />
            </div>
          )}

          <button className="btn-outline" onClick={() => setShowConfigModal(!showConfigModal)} title="Configurar conexão com Google Sheets">
            <Settings size={16} /> Planilha
          </button>

          {scriptUrl && (
            <button className="btn-outline" onClick={() => fetchSheetData(scriptUrl)} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> {loading ? 'A atualizar...' : 'Atualizar'}
            </button>
          )}

          {loggedUser && (
            <span
              style={{
                fontSize: '0.82rem',
                color: 'var(--gold-accent)',
                background: 'rgba(212, 175, 55, 0.12)',
                border: '1px solid rgba(212, 175, 55, 0.35)',
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                fontWeight: 600
              }}
            >
              👤 {loggedUser}
            </span>
          )}

          <button
            className="btn-outline"
            onClick={() => {
              localStorage.removeItem('pastora_livro_login');
              setIsAuthenticated(false);
              setLoggedUser('');
            }}
          >
            <LogOut size={15} /> Sair
          </button>
        </div>
      </header>

      {showConfigModal && (
        <div className="config-banner">
          <div style={{ flex: 1, minWidth: '280px' }}>
            <strong style={{ color: 'var(--gold-accent)', fontSize: '0.9rem', display: 'block', marginBottom: '4px' }}>
              🔗 Conexão em Tempo Real com Google Sheets ("O Porque De Servir")
            </strong>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Cole a URL do Web App (Google Apps Script) da sua planilha para sincronizar automaticamente a cada 30s:
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
            <input
              type="text"
              className="search-input"
              style={{ flex: 1, minWidth: '260px' }}
              placeholder="https://script.google.com/macros/s/.../exec"
              value={tempScriptUrl}
              onChange={(e) => setTempScriptUrl(e.target.value)}
            />
            <button
              className="btn-gold"
              onClick={() => {
                const cleaned = tempScriptUrl.trim();
                setScriptUrl(cleaned);
                localStorage.setItem('pastora_script_url', cleaned);
                setShowConfigModal(false);
                if (cleaned) fetchSheetData(cleaned);
              }}
            >
              Salvar Conexão
            </button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon military">
            <Users size={24} />
          </div>
          <div className="kpi-details">
            <h3>Pessoas na Lista</h3>
            <p>{totalConvidados}</p>
            <span className="kpi-sub">
              {convitesEnviados} convites enviados {faltamEnviarConvite > 0 ? `(${faltamEnviarConvite} faltam)` : ''}
            </span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon green">
            <Utensils size={24} />
          </div>
          <div className="kpi-details">
            <h3>Jantares Pagos</h3>
            <p>{jantaresPagos}</p>
            <span className="kpi-sub">{taxaConfirmacao}% do total ({convidadosVip} VIP)</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon gold">
            <BookOpen size={24} />
          </div>
          <div className="kpi-details">
            <h3>Livros Vendidos</h3>
            <p>{totalLivrosVendidos}</p>
            <span className="kpi-sub">Edição Capa Dura</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon amber">
            <Clock size={24} />
          </div>
          <div className="kpi-details">
            <h3>Pendentes de Jantar</h3>
            <p>{pendentesJantar}</p>
            <span className="kpi-sub">Aguardando confirmação dentro do prazo</span>
          </div>
        </div>
      </div>

      {/* Gráficos */}
      <div className="charts-grid">
        <div className="chart-card">
          <h2 className="chart-header">
            <Award size={18} color="var(--gold-accent)" /> Evolução de Convites e Confirmações por Dia
          </h2>
          <div style={{ height: '280px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timelineData}>
                <defs>
                  <linearGradient id="colorConvidados" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#d4af37" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#d4af37" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorPagos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2c3a25" vertical={false} />
                <XAxis dataKey="date" stroke="#9aa690" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#9aa690" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#1a2316', border: '1px solid #d4af37', borderRadius: '10px', color: '#f4f5f0' }}
                />
                <Area type="monotone" dataKey="convidados" name="Convidados" stroke="#d4af37" strokeWidth={3} fillOpacity={1} fill="url(#colorConvidados)" />
                <Area type="monotone" dataKey="pagos" name="Jantar Pago" stroke="#22c55e" strokeWidth={2.5} fillOpacity={1} fill="url(#colorPagos)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <h2 className="chart-header">🍽️ Status do Jantar</h2>
          <div style={{ height: '240px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={jantarPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={82}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                >
                  {jantarPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#1a2316', border: '1px solid #d4af37', borderRadius: '8px', color: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', marginTop: '4px' }}>
            {jantarPieData.map((entry, index) => (
              <div key={index} style={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <span style={{ width: '10px', height: '10px', backgroundColor: entry.color, borderRadius: '50%', marginRight: '6px' }}></span>
                {entry.name}: <strong style={{ color: 'var(--text-main)', marginLeft: '4px' }}>{entry.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="chart-card">
          <h2 className="chart-header">📚 Funil do Lançamento</h2>
          <div style={{ height: '270px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funilBarData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2c3a25" horizontal={true} vertical={false} />
                <XAxis type="number" stroke="#9aa690" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis dataKey="etapa" type="category" stroke="#f4f5f0" fontSize={11} width={118} tickLine={false} axisLine={false} />
                <RechartsTooltip
                  contentStyle={{ backgroundColor: '#1a2316', border: '1px solid #d4af37', borderRadius: '8px' }}
                  cursor={{ fill: 'rgba(212, 175, 55, 0.08)' }}
                />
                <Bar dataKey="total" name="Quantidade" fill="#d4af37" radius={[0, 6, 6, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabela de Convidados */}
      <div className="table-container">
        <div className="table-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--gold-accent)' }}>
              Lista de Convidados ({filteredData.length})
            </h2>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', padding: '0.25rem 0.6rem', borderRadius: '999px' }}>
              ● {syncStatus}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                className="search-input"
                style={{ paddingLeft: '32px' }}
                placeholder="Buscar nome ou telemóvel..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="status-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todos os Status</option>
              <option value="falta_convite">📤 Falta Enviar Convite</option>
              <option value="convite_enviado">📩 Convite Enviado</option>
              <option value="jantar_pago">✅ Jantar Pago</option>
              <option value="vip">🎖️ VIP</option>
              <option value="pendente">⏳ Pendentes de Jantar</option>
              <option value="com_livro">📚 Com Livro Comprado</option>
            </select>

            <select
              className="status-select"
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
            >
              <option value={10}>Mostrar 10</option>
              <option value={25}>Mostrar 25</option>
              <option value={50}>Mostrar 50</option>
              <option value={1000}>Mostrar Todos</option>
            </select>

            <button className="btn-gold" onClick={() => setShowAddModal(true)}>
              <UserPlus size={15} /> Adicionar Convidados
            </button>

            <button className="btn-outline" onClick={exportToCSV}>
              <Download size={15} /> Exportar CSV
            </button>
          </div>
        </div>

        {showAddModal && (
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--military-border)', background: 'rgba(0,0,0,0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <strong style={{ color: 'var(--gold-accent)', fontSize: '0.95rem' }}>
                  ➕ Adicionar Pessoas para Convidar (Lista Extra)
                </strong>
                <div className="filter-group">
                  <button
                    type="button"
                    className={`filter-btn ${addMode === 'single' ? 'active' : ''}`}
                    onClick={() => setAddMode('single')}
                  >
                    Individual
                  </button>
                  <button
                    type="button"
                    className={`filter-btn ${addMode === 'batch' ? 'active' : ''}`}
                    onClick={() => setAddMode('batch')}
                  >
                    Vários de uma vez (Lista)
                  </button>
                </div>
              </div>
              <button type="button" className="btn-outline" onClick={() => setShowAddModal(false)} style={{ padding: '0.3rem 0.6rem' }}>
                <X size={14} /> Fechar
              </button>
            </div>

            <form onSubmit={handleAddGuests}>
              {addMode === 'single' ? (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="search-input"
                    style={{ flex: 1, minWidth: '220px' }}
                    placeholder="Nome completo do convidado..."
                    value={newNome}
                    onChange={(e) => setNewNome(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    className="search-input"
                    style={{ width: '200px' }}
                    placeholder="Telemóvel (ex: 912345678)"
                    value={newTelemovel}
                    onChange={(e) => setNewTelemovel(e.target.value)}
                  />
                  <button type="submit" className="btn-gold">
                    Salvar na Lista & Planilha
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Cole abaixo um convidado por linha no formato <strong>Nome, Telemóvel</strong> (ou copie e cole direto de outra planilha/Excel):
                  </span>
                  <textarea
                    className="search-input"
                    rows={4}
                    style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
                    placeholder={'Exemplo:\nMaria Oliveira, 912345678\nJoão Santos, 934567890'}
                    value={batchText}
                    onChange={(e) => setBatchText(e.target.value)}
                    required
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn-gold">
                      Adicionar Todos à Lista
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        )}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>👤 Nome</th>
                <th>📱 Telemóvel</th>
                <th>🛒 Data/Hora da Compra</th>
                <th>📅 Convidado em</th>
                <th>⏳ Prazo</th>
                <th style={{ textAlign: 'center' }}>🍽️ Jantar Pago</th>
                <th>📖 Livro Comprado</th>
                <th style={{ textAlign: 'center' }}>📚 Total Livros</th>
              </tr>
            </thead>
            <tbody>
              {currentRows.map((row) => {
                const isRowVip = Boolean(row.vip || row.convidado_nao_paga);
                return (
                  <tr key={row.id}>
                    <td style={{ color: 'var(--text-muted)', fontWeight: 600 }}>#{row.id}</td>
                    <td style={{ fontWeight: 600, color: 'var(--text-main)' }}>{row.nome}</td>
                    <td>
                      {row.telemovel ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span>{row.telemovel}</span>
                          <a
                            href={formatWhatsAppLink(row.telemovel, row.nome)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-whatsapp"
                          >
                            <Phone size={12} /> WhatsApp
                          </a>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td style={{ color: row.data_compra ? '#4ade80' : 'var(--text-muted)', fontSize: '0.84rem', fontWeight: row.data_compra ? 500 : 400 }}>
                      {formatDateTime(row.data_compra)}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>
                      {row.convidado_em ? (
                        <span style={{ color: '#4ade80', fontWeight: 500 }}>
                          ✓ {formatInviteDate(row.convidado_em)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-whatsapp"
                          style={{
                            backgroundColor: 'rgba(212, 175, 55, 0.16)',
                            color: 'var(--gold-accent)',
                            borderColor: 'rgba(212, 175, 55, 0.45)'
                          }}
                          onClick={() => handleMarkInviteSent(row)}
                          title="Clique para confirmar que o convite foi enviado (salva data e hora na planilha)"
                        >
                          <Send size={12} /> Marcar Enviado
                        </button>
                      )}
                    </td>
                    <td>
                      {row.prazo ? (
                        <span className={`status-badge ${row.jantar_pago || isRowVip ? 'badge-paid' : 'badge-pending'}`}>
                          {formatDateShort(row.prazo)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {row.jantar_pago ? (
                        <span className="status-badge badge-paid">
                          <Check size={13} strokeWidth={3} /> Pago
                        </span>
                      ) : isRowVip ? (
                        <span className="status-badge badge-guest">
                          🎖️ VIP
                        </span>
                      ) : (
                        <span className="status-badge badge-pending">
                          Pendente
                        </span>
                      )}
                    </td>
                    <td>
                      {row.livro_comprado ? (
                        <span className="status-badge badge-book">{row.livro_comprado}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: row.total_livros > 0 ? 'var(--gold-accent)' : 'var(--text-muted)' }}>
                      {row.total_livros > 0 ? row.total_livros : '-'}
                    </td>
                  </tr>
                );
              })}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}>
                    Nenhum convidado encontrado para os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="pagination-container">
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Anterior
            </button>
            <span className="pagination-info">
              Página {currentPage} de {totalPages}
            </span>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Próximo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

