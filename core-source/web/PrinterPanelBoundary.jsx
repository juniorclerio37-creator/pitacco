import React from 'react';
export default class PrinterPanelBoundary extends React.Component{
 constructor(props){super(props);this.state={error:null}}
 static getDerivedStateFromError(error){return {error:String(error?.message||error)}}
 componentDidCatch(error,info){console.error('Pitacco printing settings error',error,info?.componentStack)}
 render(){if(this.state.error)return <div className="panel" role="alert"><h3>Editor de modelos indisponível</h3><p>A configuração de impressoras permanece acessível. O editor HTML apresentou um erro e foi isolado para não deixar a aba em branco.</p><details><summary>Detalhes técnicos</summary><pre style={{whiteSpace:'pre-wrap'}}>{this.state.error}</pre></details><button onClick={()=>this.setState({error:null})}>Tentar novamente</button></div>;return this.props.children}
}
